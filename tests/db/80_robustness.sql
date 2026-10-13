-- Robustness checks beyond the functional suites.

-- ---- Signup trigger under the real auth-service role ------------------------
set role supabase_auth_admin;
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
values ('d0000000-0000-0000-0000-000000000001', 'gotrue@test.local', '{"full_name":"Via Auth Admin"}', now());
reset role;
select test.ok(
  (select full_name from public.profiles where id = 'd0000000-0000-0000-0000-000000000001') = 'Via Auth Admin',
  'signup trigger fires when auth.users is written by the auth service role (no access to schema private needed)');

-- ---- Pinned inventory of everything "authenticated" may write ---------------
do $$
declare
  actual text[];
  expected text[] := array[
    'companies.name:UPDATE',
    'data_permissions.can_create:INSERT','data_permissions.can_create:UPDATE',
    'data_permissions.can_delete:INSERT','data_permissions.can_delete:UPDATE',
    'data_permissions.can_edit:INSERT','data_permissions.can_edit:UPDATE',
    'data_permissions.can_export:INSERT','data_permissions.can_export:UPDATE',
    'data_permissions.can_import:INSERT','data_permissions.can_import:UPDATE',
    'data_permissions.can_view:INSERT','data_permissions.can_view:UPDATE',
    'data_permissions.company_id:INSERT','data_permissions.table_id:INSERT','data_permissions.user_id:INSERT',
    'data_permissions:DELETE',
    'data_rows.company_id:INSERT','data_rows.data:INSERT','data_rows.data:UPDATE','data_rows.table_id:INSERT',
    'data_rows:DELETE',
    'profiles.full_name:UPDATE',
    'table_metadata.columns:INSERT','table_metadata.columns:UPDATE',
    'table_metadata.company_id:INSERT',
    'table_metadata.name:INSERT','table_metadata.name:UPDATE',
    'table_metadata:DELETE'
  ];
begin
  select array_agg(x order by x) into actual from (
    select table_name || ':' || privilege_type as x
      from information_schema.role_table_grants
     where grantee = 'authenticated' and table_schema = 'public'
       and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')
    union
    select table_name || '.' || column_name || ':' || privilege_type
      from information_schema.column_privileges
     where grantee = 'authenticated' and table_schema = 'public'
       and privilege_type in ('INSERT','UPDATE')
  ) t;
  if actual is distinct from (select array_agg(e order by e) from unnest(expected) e) then
    raise exception 'FAIL: write surface of "authenticated" changed. Actual: %', actual;
  end if;
  raise notice 'PASS: the exact write surface of authenticated is the reviewed, pinned set (any new write path must update this test)';
end $$;

-- Every write policy on company-data tables must require an entitled company.
do $$
declare offenders text;
begin
  select string_agg(tablename || '.' || policyname, ', ') into offenders
  from pg_policies
  where schemaname = 'public'
    and tablename in ('companies','table_metadata','data_permissions','data_rows')
    and cmd in ('INSERT','UPDATE','DELETE')
    and not (
      coalesce(qual, '') || coalesce(with_check, '') like '%company_can_write%'
      or (tablename = 'data_rows'
          and coalesce(qual, '') || coalesce(with_check, '') ~ 'accessible_table_ids\([^)]*, true\)')
    );
  if offenders is not null then
    raise exception 'FAIL: write policies without company_can_write: %', offenders;
  end if;
  raise notice 'PASS: every INSERT/UPDATE/DELETE policy on company data requires company_can_write (trial + suspension)';

  select string_agg(tablename || '.' || policyname, ', ') into offenders
  from pg_policies
  where schemaname = 'public' and tablename in ('table_metadata','data_rows') and cmd = 'SELECT'
    and not (
      coalesce(qual, '') like '%company_can_read%'
      or (tablename = 'data_rows' and coalesce(qual, '') ~ 'accessible_table_ids\([^)]*, false\)')
    );
  if offenders is not null then
    raise exception 'FAIL: read policies without company_can_read: %', offenders;
  end if;
  raise notice 'PASS: every SELECT policy on company data requires company_can_read (suspension)';
end $$;

-- ---- Foreign keys without a supporting index (large-table delete safety) -----
do $$
declare offenders text;
begin
  select string_agg(c.conrelid::regclass::text || '(' ||
           (select string_agg(a.attname, ',') from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey)) || ')', ', ')
    into offenders
  from pg_constraint c
  where c.contype = 'f' and c.connamespace = 'public'::regnamespace
    and not exists (select 1 from pg_index i where i.indrelid = c.conrelid and i.indkey[0] = any(c.conkey))
    and c.conrelid::regclass::text <> 'public.audit_logs';
  -- created_by on SMALL tables is accepted (rarely deleted); data_rows must have none.
  if offenders is not null and offenders ~ 'data_rows' then
    raise exception 'FAIL: unindexed foreign key on data_rows: %', offenders;
  end if;
  raise notice 'PASS: no unindexed foreign key on data_rows (unindexed, accepted: %)', coalesce(offenders, 'none');
end $$;

-- ---- Systematic write-path denial: expired trial ----------------------------
update public.subscriptions
   set trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days'
 where company_id = test.id('companyA');

select test.login(test.id('editorA'));   -- employee WITH create/edit/delete grants
select test.ok(public.get_my_context() ->> 'access' = 'read_only', 'expired: employee context is read_only');
select test.ok(test.count($$select 1 from public.data_rows where table_id = test.id('ordersA')$$) > 0, 'expired: employee with view can still read');
select test.throws($$insert into public.data_rows (company_id, table_id, data) values (test.id('companyA'), test.id('ordersA'), '{"x":1}')$$, '42501', 'expired: employee with can_create cannot insert');
select test.ok(test.affected($$update public.data_rows set data = '{"x":2}' where table_id = test.id('ordersA')$$) = 0, 'expired: employee with can_edit cannot update');
select test.ok(test.affected($$delete from public.data_rows where table_id = test.id('ordersA')$$) = 0, 'expired: employee with can_delete cannot delete');
select test.logout();

select test.login(test.id('adminA'));
select test.ok(test.affected($$update public.companies set name = 'Renamed Under Expiry' where id = test.id('companyA')$$) = 0, 'expired: admin cannot rename the company');
select test.ok(test.affected($$update public.table_metadata set name = 'Renamed' where id = test.id('ordersA')$$) = 0, 'expired: admin cannot rename a table');
select test.ok(test.affected($$update public.table_metadata set columns = '[]' where id = test.id('ordersA')$$) = 0, 'expired: admin cannot change table columns');
select test.ok(test.affected($$update public.data_permissions set can_edit = false where table_id = test.id('ordersA')$$) = 0, 'expired: admin cannot change permissions');
select test.ok(test.affected($$delete from public.data_permissions where table_id = test.id('ordersA')$$) = 0, 'expired: admin cannot delete permissions');
select test.ok(test.affected($$update public.profiles set full_name = 'Alice Still Editable' where id = auth.uid()$$) = 1,
  'expired: own profile name stays editable (not company data)');
select test.logout();

update public.subscriptions
   set status = 'trialing', trial_started_at = now(), trial_ends_at = now() + interval '30 days'
 where company_id = test.id('companyA');

-- ---- Systematic denial: suspension --------------------------------------------
select test.login(test.id('founder'));
select public.founder_set_company_status(test.id('companyA'), 'suspended', 'robustness test');
select test.logout();

select test.login(test.id('editorA'));
select test.ok(test.count('select 1 from public.data_rows') = 0, 'suspended: employee with grants reads nothing');
select test.throws($$insert into public.data_rows (company_id, table_id, data) values (test.id('companyA'), test.id('ordersA'), '{"x":1}')$$, '42501', 'suspended: employee cannot insert');
select test.ok(test.affected($$update public.data_rows set data = '{"x":2}'$$) = 0, 'suspended: employee cannot update');
select test.ok(test.affected($$delete from public.data_rows$$) = 0, 'suspended: employee cannot delete');
select test.throws($$select public.authorize_export(test.id('ordersA'))$$, '42501', 'suspended: export gate refuses');
select test.logout();

select test.login(test.id('adminA'));
select test.ok(test.affected($$update public.table_metadata set name = 'Nope'$$) = 0, 'suspended: admin cannot rename tables');
select test.ok(test.affected($$update public.data_permissions set can_view = true$$) = 0, 'suspended: admin cannot change permissions');
select test.ok(test.affected($$delete from public.data_permissions$$) = 0, 'suspended: admin cannot delete permissions');
select test.logout();

select test.login(test.id('founder'));
select public.founder_set_company_status(test.id('companyA'), 'active', 'robustness test done');
select test.logout();

-- ---- service_role (trusted server): NO table privileges at all -------------------
-- The server only uses it to create auth users; all company data changes go through
-- SECURITY DEFINER RPCs called with the acting user's JWT.
select test.service();
select test.throws('select 1 from public.company_members', '42501', 'service_role cannot read memberships');
select test.throws($$insert into public.company_members (company_id, user_id, role)
                     values (test.id('companyA'), 'd0000000-0000-0000-0000-000000000001', 'employee')$$, '42501',
  'service_role cannot create memberships directly (must go through add_company_member)');
select test.throws($$insert into public.audit_logs (action) values ('forged')$$, '42501', 'service_role cannot write audit logs directly');
select test.throws('select 1 from public.data_rows', '42501', 'service_role has no access to customer data rows');
select test.throws('select 1 from public.table_metadata', '42501', 'service_role has no access to table definitions');
select test.throws($$update public.subscriptions set status = 'active'$$, '42501', 'service_role cannot alter subscriptions');
select test.throws($$update public.companies set status = 'suspended'$$, '42501', 'service_role cannot alter company status directly');
select test.throws('select 1 from public.founders', '42501', 'service_role cannot touch founders');
select test.throws('select 1 from public.manual_payments', '42501', 'service_role cannot read payments');
select test.logout();

do $$
declare actual text[];
begin
  select array_agg(table_name || ':' || privilege_type order by table_name, privilege_type) into actual
  from information_schema.role_table_grants
  where grantee = 'service_role' and table_schema = 'public';
  if actual is not null then
    raise exception 'FAIL: service_role must hold no table privileges, found: %', actual;
  end if;
  raise notice 'PASS: service_role holds no table privileges (pinned)';
end $$;
