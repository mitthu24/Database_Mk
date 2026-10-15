-- PENDING STATEMENTS for project ufaimiecbxjdnapjvjmd ("Database", ap-northeast-2).
--
-- These are the pieces of migrations 05/06/07 (plus private.revoke_founder from 04)
-- that could NOT be applied through the Supabase MCP tool: every statement containing
-- a `delete from` or `drop` stalled until the tool timed out (60s), leaving no partial
-- state. Everything else in migrations 01-07 is already applied (see
-- docs/13-supabase-integration-status.md).
--
-- HOW TO APPLY: open Dashboard -> SQL Editor on project ufaimiecbxjdnapjvjmd ONLY
-- (confirm the ref in the URL), paste this whole file, run once. It is one transaction:
-- any failure rolls back everything. Then run supabase/manual/verify_pending.sql.
--
-- Source of truth is still supabase/migrations/*.sql; the text below is extracted
-- verbatim from those files (line ranges noted).

begin;

-- 04: private.revoke_founder (operator-only)
create function private.revoke_founder(p_email text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  delete from public.founders where user_id = v_user;
  perform private.write_audit(null, null, 'founder.revoked', 'user', v_user, '{}'::jsonb);
end;
$$;
revoke all on function private.revoke_founder(text) from public, anon, authenticated, service_role;

-- 05: rows_after_delete + trigger (20261013170000_m2_05_data_engine.sql 305-316, 332-333)
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
create trigger data_rows_count_delete after delete on public.data_rows
  referencing old table as old_rows for each statement execute function private.rows_after_delete();

-- 05: delete_rows (525-538)
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

-- 05: clear_table_rows, drop_logical_table (686-727)
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

-- 05: import_rows (738-844)
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

-- 06: founder_update_setting (20261013170100_m2_06_payments_settings.sql 40-60)
create function public.founder_update_setting(p_key text, p_value text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_founder() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_key not in ('payment_instructions', 'support_email', 'plan_price_text') then
    raise exception 'unknown setting' using errcode = '22023';
  end if;
  if coalesce(btrim(p_value), '') = '' then
    delete from public.platform_settings where key = p_key;
  else
    insert into public.platform_settings (key, value, updated_by) values (p_key, btrim(p_value), v_uid)
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform private.write_audit(null, v_uid, 'settings.updated', 'setting', null, jsonb_build_object('key', p_key));
end;
$$;

-- 07: set_table_permission (20261013170200_m2_07_members_and_founder_views.sql 249-288)
create function public.set_table_permission(
  p_user uuid, p_table uuid,
  p_view boolean, p_create boolean, p_edit boolean, p_delete boolean, p_import boolean, p_export boolean
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := private.my_admin_company();
  v_view boolean := coalesce(p_view, false) or coalesce(p_create, false) or coalesce(p_edit, false)
                    or coalesce(p_delete, false) or coalesce(p_import, false) or coalesce(p_export, false);
begin
  if v_uid is null or v_company is null or not private.company_can_write(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.company_members m
                  where m.user_id = p_user and m.company_id = v_company and m.role = 'employee')
     or not exists (select 1 from public.table_metadata t where t.id = p_table and t.company_id = v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  if not v_view then
    delete from public.data_permissions where user_id = p_user and table_id = p_table;
  else
    insert into public.data_permissions (company_id, user_id, table_id, can_view, can_create, can_edit,
                                         can_delete, can_import, can_export)
    values (v_company, p_user, p_table, true, coalesce(p_create, false), coalesce(p_edit, false),
            coalesce(p_delete, false), coalesce(p_import, false), coalesce(p_export, false))
    on conflict (table_id, user_id) do update
      set can_view = true, can_create = excluded.can_create, can_edit = excluded.can_edit,
          can_delete = excluded.can_delete, can_import = excluded.can_import, can_export = excluded.can_export;
  end if;

  perform private.write_audit(v_company, v_uid, 'permission.changed', 'user', p_user,
    jsonb_build_object('table_id', p_table, 'view', v_view, 'create', coalesce(p_create, false),
                       'edit', coalesce(p_edit, false), 'delete', coalesce(p_delete, false),
                       'import', coalesce(p_import, false), 'export', coalesce(p_export, false)));
end;
$$;

-- Execute privileges for the functions above
revoke all on function private.rows_after_delete() from public, anon, authenticated;
revoke all on function public.delete_rows(uuid, uuid[]), public.clear_table_rows(uuid),
  public.drop_logical_table(uuid), public.import_rows(uuid, text, jsonb, text),
  public.founder_update_setting(text, text),
  public.set_table_permission(uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean)
  from public, anon;
grant execute on function public.delete_rows(uuid, uuid[]), public.clear_table_rows(uuid),
  public.drop_logical_table(uuid), public.import_rows(uuid, text, jsonb, text),
  public.founder_update_setting(text, text),
  public.set_table_permission(uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean)
  to authenticated;

commit;
