begin;

-- M2+ / 05 — logical-table data engine.
--
-- STATUS: DRAFT — NOT APPLIED to any Supabase project (see docs/m1-dev-apply-plan.md).
-- Builds on the four M1 migrations. Every statement is additive except two
-- reviewed changes to M1 objects: table_metadata gains data_updated_at, and its
-- updated_at trigger now fires only for definition changes (name/columns).
--
-- Design rules:
--  * All business rules live in SQL functions that are tested against a real
--    PostgreSQL; the application layer is a thin, schema-validated wrapper.
--  * Column definitions carry an IMMUTABLE key and an editable label, so
--    renaming a column never rewrites row data.
--  * Row data is validated against its table's column definitions by a trigger,
--    so no write path (RPC, direct DML under RLS, import) can skip validation.
--  * Import/replace run inside ONE function call = one transaction: all rows are
--    validated before anything is deleted, and any failure rolls everything back.

-- ---------------------------------------------------------------------------
-- table_metadata: data_updated_at, and keep updated_at meaning "definition changed"
-- ---------------------------------------------------------------------------
alter table public.table_metadata add column data_updated_at timestamptz not null default now();
drop trigger set_updated_at on public.table_metadata;
create trigger set_updated_at before update of name, columns on public.table_metadata
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- import_jobs: history of every import attempt (kept after a table is dropped)
-- ---------------------------------------------------------------------------
create table public.import_jobs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  table_id       uuid,
  table_name     text not null,
  mode           text not null,
  file_name      text,
  status         text not null,
  rows_received  integer not null default 0,
  rows_inserted  integer not null default 0,
  rows_deleted   integer not null default 0,
  error_summary  jsonb not null default '{}'::jsonb,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  constraint import_jobs_mode_valid check (mode in ('append', 'replace')),
  constraint import_jobs_status_valid check (status in ('succeeded', 'failed')),
  constraint import_jobs_file_name_len check (file_name is null or char_length(file_name) <= 255)
);
create index import_jobs_company_created_idx on public.import_jobs (company_id, created_at desc);
create index import_jobs_table_idx on public.import_jobs (table_id, created_at desc);

alter table public.import_jobs enable row level security;
revoke all on public.import_jobs from public, anon, authenticated, service_role;
grant select on public.import_jobs to authenticated;
create policy import_jobs_select on public.import_jobs
  for select to authenticated
  using (private.is_company_admin(company_id) or created_by = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- small pure helpers (also used by invoker functions => EXECUTE for authenticated)
-- ---------------------------------------------------------------------------
create function private.try_numeric(p_text text) returns numeric
language plpgsql immutable
set search_path = ''
as $$
begin
  return p_text::numeric;
exception when others then
  return null;
end;
$$;

create function private.like_escape(p_text text) returns text
language sql immutable
set search_path = ''
as $$
  select replace(replace(replace(p_text, '\', '\\'), '%', '\%'), '_', '\_')
$$;

-- All values of a row joined for free-text search (keys are NOT searched).
create function private.row_text(p_data jsonb) returns text
language sql immutable
set search_path = ''
as $$
  select string_agg(v.value #>> '{}', E'\x1f') from jsonb_each(p_data) v where jsonb_typeof(v.value) <> 'null'
$$;

create function private.my_company() returns uuid
language sql stable security definer
set search_path = ''
as $$
  select m.company_id from public.company_members m
  where m.user_id = (select auth.uid()) and m.status = 'active' limit 1
$$;

create function private.my_admin_company() returns uuid
language sql stable security definer
set search_path = ''
as $$
  select m.company_id from public.company_members m
  where m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'admin' limit 1
$$;

-- ---------------------------------------------------------------------------
-- column definitions: [{key, label, type, required?}]   returns NULL when valid
-- ---------------------------------------------------------------------------
create function private.validate_columns(p_cols jsonb) returns text
language plpgsql immutable
set search_path = ''
as $$
declare
  c jsonb;
  v_keys text[] := '{}';
  v_labels text[] := '{}';
  v_key text;
  v_label text;
begin
  if p_cols is null or jsonb_typeof(p_cols) <> 'array' then
    return 'columns must be a list';
  end if;
  if jsonb_array_length(p_cols) > 200 then
    return 'a table can have at most 200 columns';
  end if;

  for c in select value from jsonb_array_elements(p_cols) loop
    if jsonb_typeof(c) <> 'object' then return 'each column must be an object'; end if;
    if exists (select 1 from jsonb_object_keys(c) k where k not in ('key', 'label', 'type', 'required')) then
      return 'unknown column property';
    end if;
    if coalesce(jsonb_typeof(c -> 'key'), '') <> 'string' or (c ->> 'key') !~ '^[a-z][a-z0-9_]{0,39}$' then
      return 'column keys must be 1-40 characters: lowercase letters, digits, underscore, starting with a letter';
    end if;
    if coalesce(jsonb_typeof(c -> 'label'), '') <> 'string' then return 'column label is required'; end if;
    v_key := c ->> 'key';
    v_label := btrim(c ->> 'label');
    if char_length(v_label) not between 1 and 120 then return 'column labels must be 1-120 characters'; end if;
    if coalesce(c ->> 'type', '') not in ('text', 'number', 'integer', 'boolean', 'date', 'datetime') then
      return 'column type must be text, number, integer, boolean, date or datetime';
    end if;
    if c ? 'required' and jsonb_typeof(c -> 'required') <> 'boolean' then
      return 'column required flag must be true or false';
    end if;
    if v_key = any (v_keys) then return 'duplicate column key "' || v_key || '"'; end if;
    if lower(v_label) = any (v_labels) then return 'duplicate column name "' || v_label || '"'; end if;
    v_keys := v_keys || v_key;
    v_labels := v_labels || lower(v_label);
  end loop;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- row validation against column definitions; returns NULL when valid.
-- MIRRORED by src/lib/data/row-validation.ts (shared test vectors keep them equal).
-- ---------------------------------------------------------------------------
create function private.row_error(p_cols jsonb, p_data jsonb) returns text
language plpgsql stable
set search_path = ''
as $$
declare
  c jsonb;
  k text;
  t text;
  v jsonb;
  v_label text;
  v_req boolean;
  s text;
  n numeric;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    return 'row must be an object';
  end if;

  for k in select jsonb_object_keys(p_data) loop
    if not exists (select 1 from jsonb_array_elements(p_cols) e where e ->> 'key' = k) then
      return 'unknown column "' || left(k, 40) || '"';
    end if;
  end loop;

  for c in select value from jsonb_array_elements(p_cols) loop
    k := c ->> 'key';
    t := c ->> 'type';
    v_label := c ->> 'label';
    v_req := coalesce((c ->> 'required')::boolean, false);
    v := p_data -> k;

    if v is null or jsonb_typeof(v) = 'null' then
      if v_req then return v_label || ' is required'; end if;
      continue;
    end if;

    if t = 'text' then
      if jsonb_typeof(v) <> 'string' then return v_label || ' must be text'; end if;
      s := v #>> '{}';
      if char_length(s) > 10000 then return v_label || ' is too long (10000 characters maximum)'; end if;
      if v_req and btrim(s) = '' then return v_label || ' is required'; end if;
    elsif t = 'number' then
      if jsonb_typeof(v) <> 'number' then return v_label || ' must be a number'; end if;
    elsif t = 'integer' then
      if jsonb_typeof(v) <> 'number' then return v_label || ' must be a whole number'; end if;
      n := (v #>> '{}')::numeric;
      if n <> trunc(n) or abs(n) > 9007199254740991 then return v_label || ' must be a whole number'; end if;
    elsif t = 'boolean' then
      if jsonb_typeof(v) <> 'boolean' then return v_label || ' must be true or false'; end if;
    elsif t = 'date' then
      if jsonb_typeof(v) <> 'string' then return v_label || ' must be a date (YYYY-MM-DD)'; end if;
      s := v #>> '{}';
      if s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return v_label || ' must be a date (YYYY-MM-DD)'; end if;
      begin
        if to_char(s::date, 'YYYY-MM-DD') <> s then return v_label || ' is not a real calendar date'; end if;
      exception when others then
        return v_label || ' is not a real calendar date';
      end;
    elsif t = 'datetime' then
      if jsonb_typeof(v) <> 'string' then return v_label || ' must be a date and time (ISO 8601)'; end if;
      s := v #>> '{}';
      -- strict ASCII pattern with real ranges (hour 00-23, minute/second 00-59); the
      -- TypeScript mirror uses the identical expression. [0-9] (not \d) so non-ASCII
      -- digits are never accepted.
      if s !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ]([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-]([01][0-9]|2[0-3])(:?[0-5][0-9])?)?$' then
        return v_label || ' must be a date and time (ISO 8601)';
      end if;
      begin
        if to_char(left(s, 10)::date, 'YYYY-MM-DD') <> left(s, 10) then
          return v_label || ' is not a real date and time';
        end if;
        perform s::timestamptz;
      exception when others then
        return v_label || ' is not a real date and time';
      end;
    end if;
  end loop;

  return null;
end;
$$;

-- Trigger: every write to data_rows is validated, whatever path it took.
-- Definer functions that have ALREADY validated a whole batch (import) or that
-- are restructuring rows (schema edits) set a transaction-local flag. Clients
-- cannot set it: no API role can run SQL or call set_config().
create function private.data_rows_validate() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_cols jsonb;
  v_err text;
begin
  if coalesce(current_setting('app.skip_row_validation', true), '') = 'on' then
    return new;
  end if;
  select t.columns into v_cols from public.table_metadata t where t.id = new.table_id;
  v_err := private.row_error(v_cols, new.data);
  if v_err is not null then
    raise exception 'row validation failed: %', v_err using errcode = '23514';
  end if;
  return new;
end;
$$;

-- AFTER (not BEFORE) on purpose: PostgreSQL runs BEFORE row triggers ahead of the
-- RLS WITH CHECK, so a BEFORE validator would let a caller who guesses another
-- tenant's table id read its column labels from the validation error. As an AFTER
-- trigger it only ever runs for rows RLS already allowed; raising still rolls the
-- statement back.
create trigger data_rows_validate after insert or update of data on public.data_rows
  for each row execute function private.data_rows_validate();

-- Trigger: validate column definitions on every table_metadata write.
create function private.table_metadata_validate() returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare v_err text;
begin
  v_err := private.validate_columns(new.columns);
  if v_err is not null then
    raise exception 'invalid columns: %', v_err using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger table_metadata_validate before insert or update of columns on public.table_metadata
  for each row execute function private.table_metadata_validate();

-- ---------------------------------------------------------------------------
-- statement-level row accounting (transition tables: one UPDATE per statement,
-- not one per row, so a 20k-row import touches table_metadata once)
-- ---------------------------------------------------------------------------
create function private.rows_after_insert() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.table_metadata t
     set row_count = t.row_count + d.n, data_updated_at = now()
    from (select table_id, count(*) as n from new_rows group by table_id) d
   where t.id = d.table_id;
  return null;
end;
$$;

create function private.rows_after_delete() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.table_metadata t
     set row_count = greatest(t.row_count - d.n, 0), data_updated_at = now()
    from (select table_id, count(*) as n from old_rows group by table_id) d
   where t.id = d.table_id;
  return null;
end;
$$;

create function private.rows_after_update() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.table_metadata t
     set data_updated_at = now()
   where t.id in (select distinct table_id from new_rows);
  return null;
end;
$$;

create trigger data_rows_count_insert after insert on public.data_rows
  referencing new table as new_rows for each statement execute function private.rows_after_insert();
create trigger data_rows_count_delete after delete on public.data_rows
  referencing old table as old_rows for each statement execute function private.rows_after_delete();
create trigger data_rows_touch_update after update on public.data_rows
  referencing new table as new_rows for each statement execute function private.rows_after_update();

-- ---------------------------------------------------------------------------
-- JSON shapes shared by the table RPCs
-- ---------------------------------------------------------------------------
create function private.table_access(p_table uuid) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case
    when private.is_company_admin(t.company_id) then
      jsonb_build_object('view', true, 'create', true, 'edit', true, 'delete', true, 'import', true, 'export', true, 'manage', true)
    else jsonb_build_object(
      'view',   private.has_table_permission(t.id, 'view'),
      'create', private.has_table_permission(t.id, 'create'),
      'edit',   private.has_table_permission(t.id, 'edit'),
      'delete', private.has_table_permission(t.id, 'delete'),
      'import', private.has_table_permission(t.id, 'import'),
      'export', private.has_table_permission(t.id, 'export'),
      'manage', false)
  end
  from public.table_metadata t where t.id = p_table
$$;

create function private.table_json(t public.table_metadata) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id, 'name', t.name, 'columns', t.columns, 'row_count', t.row_count,
    'created_at', t.created_at, 'updated_at', t.updated_at, 'data_updated_at', t.data_updated_at,
    'access', private.table_access(t.id))
$$;

-- ---------------------------------------------------------------------------
-- reads (SECURITY INVOKER: RLS decides what the caller can see)
-- ---------------------------------------------------------------------------
create function public.list_tables() returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.table_json(t) order by lower(t.name)), '[]'::jsonb)
  from public.table_metadata t
$$;

create function public.get_table(p_table uuid) returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select private.table_json(t) from public.table_metadata t where t.id = p_table
$$;

create function private.match_filter(p_data jsonb, p_key text, p_op text, p_value text) returns boolean
language plpgsql stable
set search_path = ''
as $$
declare
  v jsonb := p_data -> p_key;
  s text;
  a numeric;
  b numeric;
  v_cmp int;
begin
  s := case when v is null or jsonb_typeof(v) = 'null' then null else v #>> '{}' end;
  a := private.try_numeric(s);
  b := private.try_numeric(p_value);

  if p_op = 'empty' then return s is null or s = ''; end if;
  if p_op = 'notempty' then return s is not null and s <> ''; end if;
  if p_op = 'contains' then
    return s is not null and s ilike '%' || private.like_escape(coalesce(p_value, '')) || '%';
  end if;
  if p_op in ('eq', 'neq') then
    if s is null then return p_op = 'neq'; end if;
    return (case when a is not null and b is not null then a = b else s = p_value end) = (p_op = 'eq');
  end if;
  if p_op in ('gt', 'gte', 'lt', 'lte') then
    if s is null then return false; end if;
    if a is not null and b is not null then
      v_cmp := case when a < b then -1 when a > b then 1 else 0 end;
    else
      v_cmp := case when s < p_value then -1 when s > p_value then 1 else 0 end;
    end if;
    return case p_op when 'gt' then v_cmp > 0 when 'gte' then v_cmp >= 0 when 'lt' then v_cmp < 0 else v_cmp <= 0 end;
  end if;
  raise exception 'unknown filter operator' using errcode = '22023';
end;
$$;

-- One page of rows plus the total match count. Search covers VALUES only.
create function public.query_rows(
  p_table uuid,
  p_search text default null,
  p_filters jsonb default '[]'::jsonb,
  p_sort_key text default null,
  p_sort_dir text default 'asc',
  p_offset integer default 0,
  p_limit integer default 50
) returns jsonb
language plpgsql stable security invoker
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 500);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_dir text := lower(coalesce(p_sort_dir, 'asc'));
  v_result jsonb;
begin
  if p_filters is null or jsonb_typeof(p_filters) <> 'array' or jsonb_array_length(p_filters) > 20 then
    raise exception 'filters must be a list of at most 20 conditions' using errcode = '22023';
  end if;
  if p_sort_key is not null and p_sort_key !~ '^[a-z][a-z0-9_]{0,39}$' then
    raise exception 'invalid sort column' using errcode = '22023';
  end if;
  if v_dir not in ('asc', 'desc') then
    raise exception 'invalid sort direction' using errcode = '22023';
  end if;

  with filtered as (
    select r.id, r.row_order, r.data, r.created_at, r.updated_at
    from public.data_rows r
    where r.table_id = p_table
      and (v_search is null or private.row_text(r.data) ilike '%' || private.like_escape(v_search) || '%')
      and not exists (
        select 1 from jsonb_to_recordset(p_filters) as f(key text, op text, value text)
        where not private.match_filter(r.data, f.key, f.op, f.value)
      )
  ), ordered as (
    select f.*, count(*) over () as total,
           row_number() over (
             order by
               case when p_sort_key is not null and v_dir = 'asc'  then f.data -> p_sort_key end asc nulls last,
               case when p_sort_key is not null and v_dir = 'desc' then f.data -> p_sort_key end desc nulls last,
               f.row_order asc
           ) as rn
    from filtered f
  )
  select jsonb_build_object(
           'total', coalesce(max(o.total), 0),
           'offset', v_offset,
           'limit', v_limit,
           'rows', coalesce(jsonb_agg(
             jsonb_build_object('id', o.id, 'row_order', o.row_order, 'data', o.data,
                                'created_at', o.created_at, 'updated_at', o.updated_at)
             order by o.rn) filter (where o.rn > v_offset and o.rn <= v_offset + v_limit), '[]'::jsonb))
    into v_result
  from ordered o;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- single-row writes (SECURITY INVOKER: RLS + the validation trigger apply)
-- ---------------------------------------------------------------------------
create function public.insert_row(p_table uuid, p_data jsonb) returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare
  v_company uuid;
  r public.data_rows;
begin
  select t.company_id into v_company from public.table_metadata t where t.id = p_table;
  if v_company is null then
    raise exception 'table not found' using errcode = 'P0002';
  end if;
  insert into public.data_rows (company_id, table_id, data) values (v_company, p_table, p_data) returning * into r;
  return jsonb_build_object('id', r.id, 'row_order', r.row_order, 'data', r.data,
                            'created_at', r.created_at, 'updated_at', r.updated_at);
end;
$$;

create function public.update_row(p_table uuid, p_row uuid, p_data jsonb) returns jsonb
language plpgsql security invoker
set search_path = ''
as $$
declare r public.data_rows;
begin
  update public.data_rows set data = p_data where id = p_row and table_id = p_table returning * into r;
  if not found then
    raise exception 'row not found or not permitted' using errcode = 'P0002';
  end if;
  return jsonb_build_object('id', r.id, 'row_order', r.row_order, 'data', r.data,
                            'created_at', r.created_at, 'updated_at', r.updated_at);
end;
$$;

create function public.delete_rows(p_table uuid, p_ids uuid[]) returns integer
language plpgsql security invoker
set search_path = ''
as $$
declare n integer;
begin
  if p_ids is null or cardinality(p_ids) = 0 or cardinality(p_ids) > 1000 then
    raise exception 'select between 1 and 1000 rows' using errcode = '22023';
  end if;
  delete from public.data_rows where table_id = p_table and id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- table management (SECURITY DEFINER: admin of the caller's company, writable
-- company, audited). Uniform "not authorized" so ids cannot be probed.
-- ---------------------------------------------------------------------------
create function public.create_logical_table(p_name text, p_columns jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := private.my_admin_company();
  v_name text := btrim(coalesce(p_name, ''));
  v_err text;
  t public.table_metadata;
begin
  if v_uid is null or v_company is null or not private.company_can_write(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'table name must be 1-120 characters' using errcode = '22023';
  end if;
  v_err := private.validate_columns(p_columns);
  if v_err is not null then
    raise exception 'invalid columns: %', v_err using errcode = '22023';
  end if;
  if (select count(*) from public.table_metadata where company_id = v_company) >= 100 then
    raise exception 'a company can have at most 100 tables' using errcode = '53400';
  end if;

  insert into public.table_metadata (company_id, name, columns, created_by)
  values (v_company, v_name, p_columns, v_uid)
  returning * into t;

  perform private.write_audit(v_company, v_uid, 'table.created', 'table', t.id,
    jsonb_build_object('name', t.name, 'columns', jsonb_array_length(t.columns)));
  return private.table_json(t);
end;
$$;

create function public.rename_logical_table(p_table uuid, p_name text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := private.my_admin_company();
  v_name text := btrim(coalesce(p_name, ''));
  v_old text;
  t public.table_metadata;
begin
  select m.name into v_old from public.table_metadata m where m.id = p_table and m.company_id = v_company;
  if v_uid is null or v_company is null or v_old is null or not private.company_can_write(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'table name must be 1-120 characters' using errcode = '22023';
  end if;
  update public.table_metadata set name = v_name where id = p_table returning * into t;
  perform private.write_audit(v_company, v_uid, 'table.renamed', 'table', p_table,
    jsonb_build_object('from', v_old, 'to', v_name));
  return private.table_json(t);
end;
$$;

-- Edit the schema: add / relabel / retype / reorder / remove columns.
-- Keys are stable. Removed columns are stripped from every row; retyping and
-- making a column required are refused unless ALL existing rows already comply.
create function public.update_table_schema(p_table uuid, p_columns jsonb) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := private.my_admin_company();
  v_old jsonb;
  v_err text;
  c jsonb;
  o jsonb;
  k text;
  v_removed text[];
  v_added integer := 0;
  v_retyped integer := 0;
  t public.table_metadata;
begin
  select m.columns into v_old from public.table_metadata m where m.id = p_table and m.company_id = v_company;
  if v_uid is null or v_company is null or v_old is null or not private.company_can_write(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_err := private.validate_columns(p_columns);
  if v_err is not null then
    raise exception 'invalid columns: %', v_err using errcode = '22023';
  end if;

  for c in select value from jsonb_array_elements(p_columns) loop
    k := c ->> 'key';
    select e.value into o from jsonb_array_elements(v_old) e where e.value ->> 'key' = k;
    if o is null then
      v_added := v_added + 1;
      if coalesce((c ->> 'required')::boolean, false)
         and exists (select 1 from public.data_rows where table_id = p_table) then
        raise exception 'cannot add required column "%" to a table that already has rows', c ->> 'label'
          using errcode = '23514';
      end if;
    else
      if o ->> 'type' <> c ->> 'type' then
        v_retyped := v_retyped + 1;
        if exists (
          select 1 from public.data_rows r
          where r.table_id = p_table and jsonb_typeof(r.data -> k) not in ('null')
            and r.data ? k
            and private.row_error(
                  jsonb_build_array(jsonb_build_object('key', k, 'label', c ->> 'label', 'type', c ->> 'type')),
                  jsonb_build_object(k, r.data -> k)) is not null
        ) then
          raise exception 'existing values do not fit the new type of "%"', c ->> 'label' using errcode = '23514';
        end if;
      end if;
      if coalesce((c ->> 'required')::boolean, false) and not coalesce((o ->> 'required')::boolean, false)
         and exists (
           select 1 from public.data_rows r
           where r.table_id = p_table
             and (not (r.data ? k) or jsonb_typeof(r.data -> k) = 'null' or (r.data ->> k) = '')
         ) then
        raise exception 'column "%" has empty values, so it cannot be required', c ->> 'label' using errcode = '23514';
      end if;
    end if;
  end loop;

  v_removed := array(
    select e.value ->> 'key' from jsonb_array_elements(v_old) e
    where not exists (select 1 from jsonb_array_elements(p_columns) n where n.value ->> 'key' = e.value ->> 'key'));

  -- structural rewrite: rows are consistent with the new definition by construction
  perform set_config('app.skip_row_validation', 'on', true);
  if cardinality(v_removed) > 0 then
    update public.data_rows set data = data - v_removed where table_id = p_table and data ?| v_removed;
  end if;
  update public.table_metadata set columns = p_columns where id = p_table returning * into t;
  perform set_config('app.skip_row_validation', 'off', true);

  perform private.write_audit(v_company, v_uid, 'table.schema_updated', 'table', p_table,
    jsonb_build_object('added', v_added, 'removed', cardinality(v_removed), 'retyped', v_retyped));
  return private.table_json(t);
end;
$$;

create function public.clear_table_rows(p_table uuid) returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := private.my_admin_company();
  v_name text;
  n integer;
begin
  select m.name into v_name from public.table_metadata m where m.id = p_table and m.company_id = v_company;
  if v_uid is null or v_company is null or v_name is null or not private.company_can_write(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.data_rows where table_id = p_table;
  get diagnostics n = row_count;
  perform private.write_audit(v_company, v_uid, 'table.cleared', 'table', p_table,
    jsonb_build_object('name', v_name, 'rows_deleted', n));
  return n;
end;
$$;

create function public.drop_logical_table(p_table uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := private.my_admin_company();
  v_name text;
  v_rows bigint;
begin
  select m.name, m.row_count into v_name, v_rows
  from public.table_metadata m where m.id = p_table and m.company_id = v_company;
  if v_uid is null or v_company is null or v_name is null or not private.company_can_write(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  delete from public.table_metadata where id = p_table;
  perform private.write_audit(v_company, v_uid, 'table.dropped', 'table', p_table,
    jsonb_build_object('name', v_name, 'rows_deleted', v_rows));
end;
$$;

-- ---------------------------------------------------------------------------
-- import: append | replace, atomic. p_rows = JSON array of objects keyed by
-- column KEY (the application maps file headers to keys before calling).
--  * validation failures are an EXPECTED outcome: a failed job is recorded and
--    {ok:false, errors:[…]} is returned (nothing else changes);
--  * unexpected errors raise, rolling back the entire call (replace included);
--  * replace deletes the old rows only after every new row has been validated,
--    and in the same transaction as the insert.
-- ---------------------------------------------------------------------------
create function public.import_rows(p_table uuid, p_mode text, p_rows jsonb, p_file_name text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  c_max_rows constant integer := 50000;
  c_max_table_rows constant bigint := 200000;
  v_uid uuid := (select auth.uid());
  v_company uuid;
  v_name text;
  v_cols jsonb;
  v_current bigint;
  v_admin boolean;
  v_allowed boolean := false;
  v_count integer;
  v_err text;
  v_errors jsonb := '[]'::jsonb;
  v_error_count integer := 0;
  v_deleted integer := 0;
  v_inserted integer := 0;
  v_job uuid;
  e record;
begin
  select m.company_id, m.name, m.columns, m.row_count
    into v_company, v_name, v_cols, v_current
  from public.table_metadata m where m.id = p_table;

  if v_uid is null or v_company is null or not private.company_can_write(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_mode not in ('append', 'replace') then
    raise exception 'mode must be append or replace' using errcode = '22023';
  end if;

  v_admin := private.is_company_admin(v_company);
  if p_mode = 'replace' then
    v_allowed := v_admin;
  else
    v_allowed := v_admin or exists (select 1 from private.accessible_table_ids('import', true) a(id) where a.id = p_table);
  end if;
  if not v_allowed then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'rows must be a list' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_rows);

  if v_count = 0 then
    v_errors := jsonb_build_array(jsonb_build_object('row', 0, 'message', 'the file contains no data rows'));
    v_error_count := 1;
  elsif v_count > c_max_rows then
    v_errors := jsonb_build_array(jsonb_build_object('row', 0, 'message', 'too many rows (maximum ' || c_max_rows || ' per import)'));
    v_error_count := 1;
  elsif p_mode = 'append' and v_current + v_count > c_max_table_rows then
    v_errors := jsonb_build_array(jsonb_build_object('row', 0, 'message', 'the table would exceed ' || c_max_table_rows || ' rows'));
    v_error_count := 1;
  else
    for e in select r.value as val, r.ord from jsonb_array_elements(p_rows) with ordinality as r(value, ord) loop
      v_err := private.row_error(v_cols, e.val);
      if v_err is not null then
        v_error_count := v_error_count + 1;
        if v_error_count <= 20 then
          v_errors := v_errors || jsonb_build_array(jsonb_build_object('row', e.ord, 'message', v_err));
        end if;
      end if;
    end loop;
  end if;

  if v_error_count > 0 then
    insert into public.import_jobs (company_id, table_id, table_name, mode, file_name, status,
                                    rows_received, error_summary, created_by)
    values (v_company, p_table, v_name, p_mode, left(p_file_name, 255), 'failed',
            coalesce(v_count, 0), jsonb_build_object('error_count', v_error_count, 'errors', v_errors), v_uid)
    returning id into v_job;
    perform private.write_audit(v_company, v_uid, 'import.failed', 'table', p_table,
      jsonb_build_object('mode', p_mode, 'rows', v_count, 'error_count', v_error_count));
    return jsonb_build_object('ok', false, 'job_id', v_job, 'error_count', v_error_count, 'errors', v_errors);
  end if;

  -- All rows validated. Everything below is one transaction.
  perform set_config('app.skip_row_validation', 'on', true);
  if p_mode = 'replace' then
    delete from public.data_rows where table_id = p_table;
    get diagnostics v_deleted = row_count;
  end if;
  insert into public.data_rows (company_id, table_id, data)
  select v_company, p_table, r.value
  from jsonb_array_elements(p_rows) with ordinality as r(value, ord)
  order by r.ord;
  get diagnostics v_inserted = row_count;
  perform set_config('app.skip_row_validation', 'off', true);

  insert into public.import_jobs (company_id, table_id, table_name, mode, file_name, status,
                                  rows_received, rows_inserted, rows_deleted, created_by)
  values (v_company, p_table, v_name, p_mode, left(p_file_name, 255), 'succeeded',
          v_count, v_inserted, v_deleted, v_uid)
  returning id into v_job;
  perform private.write_audit(v_company, v_uid, 'import.' || p_mode, 'table', p_table,
    jsonb_build_object('rows_inserted', v_inserted, 'rows_deleted', v_deleted, 'file', left(p_file_name, 255)));

  return jsonb_build_object('ok', true, 'job_id', v_job, 'mode', p_mode,
                            'inserted', v_inserted, 'deleted', v_deleted);
end;
$$;

create function public.list_import_jobs(p_table uuid default null, p_limit integer default 50)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(j) order by j.created_at desc), '[]'::jsonb)
  from (
    select id, table_id, table_name, mode, file_name, status, rows_received, rows_inserted,
           rows_deleted, error_summary, created_by, created_at
    from public.import_jobs
    where p_table is null or table_id = p_table
    order by created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200)
  ) j
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges
-- ---------------------------------------------------------------------------
revoke all on function private.try_numeric(text), private.like_escape(text), private.row_text(jsonb),
  private.my_company(), private.my_admin_company(), private.validate_columns(jsonb),
  private.row_error(jsonb, jsonb), private.match_filter(jsonb, text, text, text),
  private.table_access(uuid), private.table_json(public.table_metadata),
  private.data_rows_validate(), private.table_metadata_validate(),
  private.rows_after_insert(), private.rows_after_delete(), private.rows_after_update()
  from public, anon, authenticated;

-- needed by SECURITY INVOKER functions that run as the caller
grant execute on function private.try_numeric(text), private.like_escape(text), private.row_text(jsonb),
  private.match_filter(jsonb, text, text, text),
  private.table_access(uuid), private.table_json(public.table_metadata)
  to authenticated;

revoke all on function public.list_tables(), public.get_table(uuid),
  public.query_rows(uuid, text, jsonb, text, text, integer, integer),
  public.insert_row(uuid, jsonb), public.update_row(uuid, uuid, jsonb), public.delete_rows(uuid, uuid[]),
  public.create_logical_table(text, jsonb), public.rename_logical_table(uuid, text),
  public.update_table_schema(uuid, jsonb), public.clear_table_rows(uuid), public.drop_logical_table(uuid),
  public.import_rows(uuid, text, jsonb, text), public.list_import_jobs(uuid, integer)
  from public, anon;

grant execute on function public.list_tables(), public.get_table(uuid),
  public.query_rows(uuid, text, jsonb, text, text, integer, integer),
  public.insert_row(uuid, jsonb), public.update_row(uuid, uuid, jsonb), public.delete_rows(uuid, uuid[]),
  public.create_logical_table(text, jsonb), public.rename_logical_table(uuid, text),
  public.update_table_schema(uuid, jsonb), public.clear_table_rows(uuid), public.drop_logical_table(uuid),
  public.import_rows(uuid, text, jsonb, text), public.list_import_jobs(uuid, integer)
  to authenticated;

commit;
