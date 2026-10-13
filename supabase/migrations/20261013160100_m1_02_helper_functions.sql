begin;

-- M1 / 02 — authorization helper functions (private schema).
--
-- STATUS: DRAFT — NOT APPLIED. See 01 for the review gate.
--
-- All functions: SECURITY DEFINER, search_path = '' (every object schema
-- qualified), owned by the migration role so they read the membership tables
-- without being subject to RLS themselves. That is also what prevents
-- recursive policy evaluation (company_members policies call these functions,
-- and these functions read company_members).
--
-- The "private" schema is not exposed by PostgREST, so none of these can be
-- invoked as an API/RPC endpoint. "authenticated" needs EXECUTE + USAGE only
-- because RLS policies run with the caller's privileges.

revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- is_founder ----------------------------------------------------------------
create function private.is_founder() returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.founders f where f.user_id = (select auth.uid())
  );
$$;

-- is_company_member: active member (admin or employee) of the company ------
create function private.is_company_member(target_company uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = target_company
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

-- is_company_admin: active admin of the company ------------------------------
create function private.is_company_admin(target_company uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.company_members m
    where m.company_id = target_company
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role = 'admin'
  );
$$;

-- company_can_read: company is not suspended --------------------------------
-- Suspended company => no data access for anyone but the founder console
-- (which never reads customer data). Expired trial does NOT block reads.
create function private.company_can_read(target_company uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.companies c
    where c.id = target_company and c.status = 'active'
  );
$$;

-- company_can_write: not suspended AND subscription currently entitled ------
-- Entitled = trialing with trial_ends_at in the future, or active with no
-- period end / a period end in the future. Evaluated at query time, so trial
-- expiry needs no cron job. Expired / canceled / past_due => read-only mode.
create function private.company_can_write(target_company uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.companies c
    join public.subscriptions s on s.company_id = c.id
    where c.id = target_company
      and c.status = 'active'
      and (
        (s.status = 'trialing' and s.trial_ends_at > now())
        or (s.status = 'active' and (s.current_period_end is null or s.current_period_end > now()))
      )
  );
$$;

-- has_table_permission: employee grant check (active member only) ----------
create function private.has_table_permission(p_table uuid, p_perm text) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.data_permissions p
    join public.company_members m
      on m.company_id = p.company_id and m.user_id = p.user_id
    where p.table_id = p_table
      and p.user_id = (select auth.uid())
      and m.status = 'active'
      and case p_perm
            when 'view'   then p.can_view
            when 'create' then p.can_create
            when 'edit'   then p.can_edit
            when 'delete' then p.can_delete
            when 'import' then p.can_import
            when 'export' then p.can_export
            else false
          end
  );
$$;

-- accessible_table_ids: the logical tables the caller may touch for an operation.
-- Used by the data_rows policies as an UNCORRELATED subquery, so PostgreSQL
-- evaluates it ONCE per statement (hashed) instead of calling the permission
-- functions for every row. Benchmark (200k rows, local PostgreSQL 16): filtered
-- scans dropped from seconds to tens of milliseconds, with identical semantics.
--   p_perm  : view | create | edit | delete | import | export
--   p_write : true  => company must be entitled (not suspended, not expired)
--             false => company merely must not be suspended
-- Admins implicitly hold every permission on their own company's tables.
create function private.accessible_table_ids(p_perm text, p_write boolean) returns setof uuid
language sql stable security definer
set search_path = ''
as $$
  select t.id
  from public.company_members m
  join public.table_metadata t on t.company_id = m.company_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and case when p_write then private.company_can_write(m.company_id)
             else private.company_can_read(m.company_id) end
    and (
      m.role = 'admin'
      or exists (
        select 1 from public.data_permissions p
        where p.table_id = t.id and p.user_id = m.user_id
          and case p_perm
                when 'view'   then p.can_view
                when 'create' then p.can_create
                when 'edit'   then p.can_edit
                when 'delete' then p.can_delete
                when 'import' then p.can_import
                when 'export' then p.can_export
                else false
              end
      )
    );
$$;

-- shares_company_as_admin: caller administers a company the profile belongs to
create function private.shares_company_as_admin(p_profile uuid) returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.company_members target
    join public.company_members me
      on me.company_id = target.company_id
    where target.user_id = p_profile
      and me.user_id = (select auth.uid())
      and me.status = 'active'
      and me.role = 'admin'
  );
$$;

-- write_audit: internal helper used by other definer functions --------------
create function private.write_audit(
  p_company uuid, p_actor uuid, p_action text,
  p_target_type text, p_target_id uuid, p_metadata jsonb
) returns void
language sql security definer
set search_path = ''
as $$
  insert into public.audit_logs (company_id, actor_id, action, target_type, target_id, metadata)
  values (p_company, p_actor, p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- Execute privileges ---------------------------------------------------------
revoke all on function private.is_founder() from public, anon;
revoke all on function private.is_company_member(uuid) from public, anon;
revoke all on function private.is_company_admin(uuid) from public, anon;
revoke all on function private.company_can_read(uuid) from public, anon;
revoke all on function private.company_can_write(uuid) from public, anon;
revoke all on function private.has_table_permission(uuid, text) from public, anon;
revoke all on function private.shares_company_as_admin(uuid) from public, anon;
revoke all on function private.accessible_table_ids(text, boolean) from public, anon;
revoke all on function private.write_audit(uuid, uuid, text, text, uuid, jsonb) from public, anon, authenticated;

grant execute on function private.is_founder() to authenticated, service_role;
grant execute on function private.is_company_member(uuid) to authenticated, service_role;
grant execute on function private.is_company_admin(uuid) to authenticated, service_role;
grant execute on function private.company_can_read(uuid) to authenticated, service_role;
grant execute on function private.company_can_write(uuid) to authenticated, service_role;
grant execute on function private.has_table_permission(uuid, text) to authenticated, service_role;
grant execute on function private.shares_company_as_admin(uuid) to authenticated, service_role;
grant execute on function private.accessible_table_ids(text, boolean) to authenticated, service_role;
-- write_audit: owner only (called from other SECURITY DEFINER functions).

commit;
