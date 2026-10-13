begin;

-- M2+ / 07 — company profile, member + permission management, founder views.
--
-- STATUS: DRAFT — NOT APPLIED to any Supabase project.
--
-- Members: clients never write company_members directly. Admin actions go
-- through the SECURITY DEFINER RPCs below, which derive the company from the
-- caller's own membership (never from a parameter), so an admin of company A
-- cannot touch company B. The auth user itself is created by the trusted
-- server (service-role key, invite email); the RPC then attaches it to the
-- caller's company, so the database re-verifies the admin on every step.

-- ---------------------------------------------------------------------------
-- company profile
-- ---------------------------------------------------------------------------
alter table public.companies
  add column contact_email text,
  add column phone text,
  add column address text,
  add constraint companies_contact_email_len check (contact_email is null or char_length(contact_email) <= 254),
  add constraint companies_phone_len check (phone is null or char_length(phone) <= 40),
  add constraint companies_address_len check (address is null or char_length(address) <= 500);

create function public.get_company_profile() returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select jsonb_build_object('id', c.id, 'name', c.name, 'status', c.status, 'contact_email', c.contact_email,
                            'phone', c.phone, 'address', c.address, 'created_at', c.created_at)
  from public.companies c
  where c.id = private.my_company()
$$;

create function public.update_company_profile(p_name text, p_contact_email text, p_phone text, p_address text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := private.my_admin_company();
  v_name text := btrim(coalesce(p_name, ''));
  v_email text := nullif(btrim(coalesce(p_contact_email, '')), '');
begin
  if v_uid is null or v_company is null or not private.company_can_write(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'company name must be 2-120 characters' using errcode = '22023';
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'contact email is not valid' using errcode = '22023';
  end if;
  update public.companies
     set name = v_name, contact_email = v_email,
         phone = nullif(btrim(coalesce(p_phone, '')), ''), address = nullif(btrim(coalesce(p_address, '')), '')
   where id = v_company;
  perform private.write_audit(v_company, v_uid, 'company.profile_updated', 'company', v_company, '{}'::jsonb);
  return public.get_company_profile();
end;
$$;

create function public.update_my_profile(p_full_name text) returns void
language plpgsql security invoker
set search_path = ''
as $$
begin
  if char_length(coalesce(btrim(p_full_name), '')) not between 1 and 120 then
    raise exception 'name must be 1-120 characters' using errcode = '22023';
  end if;
  update public.profiles set full_name = btrim(p_full_name) where id = (select auth.uid());
end;
$$;

-- ---------------------------------------------------------------------------
-- members
-- ---------------------------------------------------------------------------
create function private.next_employee_code(p_company uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare v_next integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('employee_code:' || p_company::text, 0));
  select coalesce(max((substring(employee_code from '^EMP-(\d+)$'))::integer), 0) + 1
    into v_next from public.company_members where company_id = p_company;
  return 'EMP-' || lpad(v_next::text, 4, '0');
end;
$$;

create function private.member_json(m public.company_members) returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'user_id', m.user_id, 'role', m.role, 'status', m.status,
    'employee_code', m.employee_code, 'created_at', m.created_at,
    'email', p.email, 'full_name', p.full_name,
    'tables_with_access', (select count(*) from public.data_permissions d
                            where d.company_id = m.company_id and d.user_id = m.user_id and d.can_view))
  from public.profiles p where p.id = m.user_id
$$;

-- admins see everyone in their company; an employee sees only themselves (RLS)
create function public.list_members() returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.member_json(m) order by m.created_at), '[]'::jsonb)
  from public.company_members m
$$;

create function public.add_company_member(p_user uuid, p_employee_code text default null) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := private.my_admin_company();
  v_code text := nullif(btrim(coalesce(p_employee_code, '')), '');
  m public.company_members;
begin
  if v_uid is null or v_company is null or not private.company_can_write(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_user) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.founders f where f.user_id = p_user)
     or exists (select 1 from public.company_members x where x.user_id = p_user) then
    raise exception 'user cannot be added to a company' using errcode = '23505';
  end if;
  if (select count(*) from public.company_members where company_id = v_company) >= 500 then
    raise exception 'a company can have at most 500 members' using errcode = '53400';
  end if;

  insert into public.company_members (company_id, user_id, role, employee_code, created_by)
  values (v_company, p_user, 'employee', coalesce(v_code, private.next_employee_code(v_company)), v_uid)
  returning * into m;

  perform private.write_audit(v_company, v_uid, 'member.added', 'user', p_user,
    jsonb_build_object('employee_code', m.employee_code));
  return private.member_json(m);
end;
$$;

create function public.set_member_status(p_member uuid, p_status text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := private.my_admin_company();
  m public.company_members;
begin
  if v_uid is null or v_company is null or not private.company_can_write(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status not in ('active', 'disabled') then
    raise exception 'status must be active or disabled' using errcode = '22023';
  end if;
  select * into m from public.company_members where id = p_member and company_id = v_company for update;
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if m.user_id = v_uid then
    raise exception 'you cannot change your own status' using errcode = '23514';
  end if;
  update public.company_members set status = p_status where id = p_member returning * into m;
  perform private.write_audit(v_company, v_uid, 'member.status_changed', 'user', m.user_id,
    jsonb_build_object('status', p_status));
  return private.member_json(m);
end;
$$;

create function public.set_member_role(p_member uuid, p_role text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := private.my_admin_company();
  m public.company_members;
begin
  if v_uid is null or v_company is null or not private.company_can_write(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  -- only company roles exist here: there is no way to assign 'founder'
  if p_role not in ('admin', 'employee') then
    raise exception 'role must be admin or employee' using errcode = '22023';
  end if;
  select * into m from public.company_members where id = p_member and company_id = v_company for update;
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if m.user_id = v_uid then
    raise exception 'you cannot change your own role' using errcode = '23514';
  end if;
  update public.company_members set role = p_role where id = p_member returning * into m;
  perform private.write_audit(v_company, v_uid, 'member.role_changed', 'user', m.user_id,
    jsonb_build_object('role', p_role));
  return private.member_json(m);
end;
$$;

create function public.set_member_code(p_member uuid, p_code text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := private.my_admin_company();
  v_code text := nullif(btrim(coalesce(p_code, '')), '');
  m public.company_members;
begin
  if v_uid is null or v_company is null or not private.company_can_write(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  update public.company_members set employee_code = v_code
   where id = p_member and company_id = v_company returning * into m;
  if not found then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  perform private.write_audit(v_company, v_uid, 'member.code_changed', 'user', m.user_id, '{}'::jsonb);
  return private.member_json(m);
end;
$$;

-- ---------------------------------------------------------------------------
-- table permissions
-- ---------------------------------------------------------------------------
create function public.list_permissions(p_user uuid default null) returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'user_id', d.user_id, 'table_id', d.table_id, 'table_name', t.name,
      'can_view', d.can_view, 'can_create', d.can_create, 'can_edit', d.can_edit,
      'can_delete', d.can_delete, 'can_import', d.can_import, 'can_export', d.can_export)
    order by lower(t.name)), '[]'::jsonb)
  from public.data_permissions d
  join public.table_metadata t on t.id = d.table_id
  where p_user is null or d.user_id = p_user
$$;

-- Upsert one employee's permissions on one table (all false => remove the grant).
-- Any operation implies view access, matching the data_permissions constraint.
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

-- ---------------------------------------------------------------------------
-- company audit log (admins read their own company's events)
-- ---------------------------------------------------------------------------
create function public.list_company_audit(p_action text default null, p_limit integer default 50, p_offset integer default 0)
returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  with f as (
    select a.* from public.audit_logs a
    where (p_action is null or a.action like private.like_escape(p_action) || '%')
  ), page as (
    select * from f order by created_at desc, id desc
    offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  select jsonb_build_object(
    'total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
       'id', g.id, 'created_at', g.created_at, 'action', g.action, 'target_type', g.target_type,
       'target_id', g.target_id, 'metadata', g.metadata, 'actor_id', g.actor_id,
       'actor_email', (select p.email from public.profiles p where p.id = g.actor_id)) order by g.created_at desc, g.id desc)
     from page g), '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- founder views (SECURITY DEFINER; every function checks is_founder())
-- ---------------------------------------------------------------------------
create function private.company_access(p_company uuid) returns text
language sql stable security definer
set search_path = ''
as $$
  select case when c.status <> 'active' then 'suspended'
              when private.company_can_write(c.id) then 'full'
              else 'read_only' end
  from public.companies c where c.id = p_company
$$;

create function private.require_founder() returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_founder() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create function public.founder_overview() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare r jsonb;
begin
  perform private.require_founder();
  with co as (
    select c.id, c.status, c.created_at, s.status as sub_status, s.trial_ends_at,
           private.company_access(c.id) as access
    from public.companies c left join public.subscriptions s on s.company_id = c.id
  )
  select jsonb_build_object(
    'companies_total', (select count(*) from co),
    'suspended', (select count(*) from co where access = 'suspended'),
    'trialing', (select count(*) from co where access = 'full' and sub_status = 'trialing'),
    'active_paid', (select count(*) from co where access = 'full' and sub_status = 'active'),
    'expired', (select count(*) from co where access = 'read_only'),
    'trials_ending_7d', (select count(*) from co where access = 'full' and sub_status = 'trialing'
                          and trial_ends_at <= now() + interval '7 days'),
    'members_total', (select count(*) from public.company_members),
    'tables_total', (select count(*) from public.table_metadata),
    'rows_total', (select coalesce(sum(row_count), 0) from public.table_metadata),
    'payments_pending', (select count(*) from public.manual_payments where status = 'pending'),
    'payments_approved_30d', coalesce((
        select jsonb_agg(jsonb_build_object('currency', currency, 'total', total) order by currency)
        from (select currency, sum(amount) as total from public.manual_payments
               where status = 'approved' and reviewed_at >= now() - interval '30 days' group by currency) x), '[]'::jsonb),
    'signups_by_month', (
        select jsonb_agg(jsonb_build_object('month', to_char(m.month, 'YYYY-MM'),
               'count', (select count(*) from co where date_trunc('month', co.created_at) = m.month)) order by m.month)
        from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m(month))
  ) into r;
  return r;
end;
$$;

create function public.founder_list_companies(
  p_search text default null, p_state text default 'all', p_limit integer default 25, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  r jsonb;
begin
  perform private.require_founder();
  if p_state not in ('all', 'trialing', 'active', 'expired', 'suspended') then
    raise exception 'unknown state filter' using errcode = '22023';
  end if;

  with base as (
    select c.id, c.name, c.status, c.created_at, s.plan, s.status as sub_status, s.trial_ends_at, s.current_period_end,
           private.company_access(c.id) as access,
           (select count(*) from public.company_members m where m.company_id = c.id) as members,
           (select count(*) from public.table_metadata t where t.company_id = c.id) as tables,
           (select p.email from public.company_members m join public.profiles p on p.id = m.user_id
             where m.company_id = c.id and m.role = 'admin' order by m.created_at limit 1) as admin_email
    from public.companies c left join public.subscriptions s on s.company_id = c.id
  ), f as (
    select * from base b
    where (v_search is null or b.name ilike '%' || private.like_escape(v_search) || '%'
           or coalesce(b.admin_email, '') ilike '%' || private.like_escape(v_search) || '%')
      and case p_state
            when 'all' then true
            when 'suspended' then b.access = 'suspended'
            when 'expired' then b.access = 'read_only'
            when 'trialing' then b.access = 'full' and b.sub_status = 'trialing'
            when 'active' then b.access = 'full' and b.sub_status = 'active'
          end
  ), page as (select * from f order by created_at desc, id offset v_offset limit v_limit)
  select jsonb_build_object('total', (select count(*) from f), 'offset', v_offset, 'limit', v_limit,
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'name', g.name, 'status', g.status, 'created_at', g.created_at, 'plan', g.plan,
        'subscription_status', g.sub_status, 'trial_ends_at', g.trial_ends_at,
        'current_period_end', g.current_period_end, 'access', g.access, 'members', g.members,
        'tables', g.tables, 'admin_email', g.admin_email) order by g.created_at desc, g.id) from page g), '[]'::jsonb))
  into r;
  return r;
end;
$$;

create function public.founder_company_detail(p_company uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare r jsonb;
begin
  perform private.require_founder();
  select jsonb_build_object(
    'id', c.id, 'name', c.name, 'status', c.status, 'created_at', c.created_at,
    'contact_email', c.contact_email, 'phone', c.phone, 'address', c.address,
    'access', private.company_access(c.id),
    'subscription', jsonb_build_object('plan', s.plan, 'status', s.status, 'trial_started_at', s.trial_started_at,
                                       'trial_ends_at', s.trial_ends_at, 'current_period_end', s.current_period_end),
    'members', (select count(*) from public.company_members m where m.company_id = c.id),
    'tables', (select count(*) from public.table_metadata t where t.company_id = c.id),
    'rows', (select coalesce(sum(t.row_count), 0) from public.table_metadata t where t.company_id = c.id),
    'payments', coalesce((select jsonb_agg(private.payment_json(p) order by p.created_at desc)
                            from public.manual_payments p where p.company_id = c.id), '[]'::jsonb))
  into r
  from public.companies c left join public.subscriptions s on s.company_id = c.id
  where c.id = p_company;
  if r is null then
    raise exception 'company not found' using errcode = 'P0002';
  end if;
  return r;
end;
$$;

create function public.founder_list_members(p_company uuid) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  perform private.require_founder();
  return coalesce((select jsonb_agg(private.member_json(m) order by m.created_at)
                    from public.company_members m where m.company_id = p_company), '[]'::jsonb);
end;
$$;

create function public.founder_list_payments(p_status text default null, p_limit integer default 25, p_offset integer default 0)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare r jsonb;
begin
  perform private.require_founder();
  if p_status is not null and p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'unknown status filter' using errcode = '22023';
  end if;
  with f as (select p.* from public.manual_payments p where p_status is null or p.status = p_status),
  page as (select * from f order by (status = 'pending') desc, created_at desc
           offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 25), 1), 100))
  select jsonb_build_object('total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(private.payment_json(g) || jsonb_build_object(
        'company_name', (select c.name from public.companies c where c.id = g.company_id),
        'submitted_by_email', (select pr.email from public.profiles pr where pr.id = g.submitted_by))
      order by (g.status = 'pending') desc, g.created_at desc) from page g), '[]'::jsonb))
  into r;
  return r;
end;
$$;

create function public.founder_audit(
  p_company uuid default null, p_action text default null, p_limit integer default 50, p_offset integer default 0
) returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare r jsonb;
begin
  perform private.require_founder();
  with f as (
    select a.* from public.audit_logs a
    where (p_company is null or a.company_id = p_company)
      and (p_action is null or a.action like private.like_escape(p_action) || '%')
  ), page as (
    select * from f order by created_at desc, id desc
    offset greatest(coalesce(p_offset, 0), 0) limit least(greatest(coalesce(p_limit, 50), 1), 200)
  )
  select jsonb_build_object('total', (select count(*) from f),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', g.id, 'created_at', g.created_at, 'action', g.action, 'company_id', g.company_id,
        'company_name', (select c.name from public.companies c where c.id = g.company_id),
        'actor_id', g.actor_id, 'actor_email', (select p.email from public.profiles p where p.id = g.actor_id),
        'target_type', g.target_type, 'target_id', g.target_id, 'metadata', g.metadata)
      order by g.created_at desc, g.id desc) from page g), '[]'::jsonb))
  into r;
  return r;
end;
$$;

-- Founder provisions a company for an auth user the trusted server just invited.
-- Trial dates come from the column defaults (server clock).
create function public.founder_create_company(p_admin_user uuid, p_name text) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_founder();
  v_name text := btrim(coalesce(p_name, ''));
  v_company uuid;
begin
  if char_length(v_name) not between 2 and 120 then
    raise exception 'company name must be 2-120 characters' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_admin_user) then
    raise exception 'user not found' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.founders f where f.user_id = p_admin_user)
     or exists (select 1 from public.company_members m where m.user_id = p_admin_user) then
    raise exception 'user cannot administer a company' using errcode = '23505';
  end if;

  insert into public.companies (name, created_by) values (v_name, p_admin_user) returning id into v_company;
  insert into public.company_members (company_id, user_id, role, created_by) values (v_company, p_admin_user, 'admin', v_uid);
  insert into public.subscriptions (company_id) values (v_company);
  perform private.write_audit(v_company, v_uid, 'company.provisioned', 'company', v_company,
    jsonb_build_object('name', v_name, 'admin_user', p_admin_user));
  return jsonb_build_object('company_id', v_company);
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges
-- ---------------------------------------------------------------------------
revoke all on function private.next_employee_code(uuid), private.member_json(public.company_members),
  private.company_access(uuid), private.require_founder()
  from public, anon, authenticated;
grant execute on function private.member_json(public.company_members) to authenticated;
-- used inside SECURITY INVOKER get_company_profile(); returns only the caller's own company id
grant execute on function private.my_company() to authenticated;

revoke all on function public.get_company_profile(), public.update_company_profile(text, text, text, text),
  public.update_my_profile(text), public.list_members(), public.add_company_member(uuid, text),
  public.set_member_status(uuid, text), public.set_member_role(uuid, text), public.set_member_code(uuid, text),
  public.list_permissions(uuid),
  public.set_table_permission(uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean),
  public.list_company_audit(text, integer, integer),
  public.founder_overview(), public.founder_list_companies(text, text, integer, integer),
  public.founder_company_detail(uuid), public.founder_list_members(uuid),
  public.founder_list_payments(text, integer, integer), public.founder_audit(uuid, text, integer, integer),
  public.founder_create_company(uuid, text)
  from public, anon;
grant execute on function public.get_company_profile(), public.update_company_profile(text, text, text, text),
  public.update_my_profile(text), public.list_members(), public.add_company_member(uuid, text),
  public.set_member_status(uuid, text), public.set_member_role(uuid, text), public.set_member_code(uuid, text),
  public.list_permissions(uuid),
  public.set_table_permission(uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean),
  public.list_company_audit(text, integer, integer),
  public.founder_overview(), public.founder_list_companies(text, text, integer, integer),
  public.founder_company_detail(uuid), public.founder_list_members(uuid),
  public.founder_list_payments(text, integer, integer), public.founder_audit(uuid, text, integer, integer),
  public.founder_create_company(uuid, text)
  to authenticated;

commit;
