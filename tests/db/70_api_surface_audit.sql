-- Structural checks over the whole exposed surface.

-- RLS enabled on every M1 table
select test.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ('profiles','founders','companies','company_members','subscriptions',
                        'table_metadata','data_permissions','data_rows','audit_logs')
      and not c.relrowsecurity),
  'RLS is enabled on every M1 table');

-- anon has no privilege on any M1 table
select test.ok(
  not exists (
    select 1 from information_schema.role_table_grants g
    where g.grantee = 'anon' and g.table_schema = 'public'
      and g.table_name in ('profiles','founders','companies','company_members','subscriptions',
                           'table_metadata','data_permissions','data_rows','audit_logs')),
  'anon holds no privileges on any M1 table');

-- no table-level write privilege on protected tables for authenticated
select test.ok(
  not exists (
    select 1 from information_schema.role_table_grants g
    where g.grantee = 'authenticated' and g.table_schema = 'public'
      and g.table_name in ('companies','company_members','subscriptions','founders','audit_logs','profiles')
      and g.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')),
  'authenticated has no table-level write privilege on protected tables');

-- column-level: the only writable columns for authenticated on protected tables
select test.ok(
  (select array_agg(table_name || '.' || column_name order by table_name, column_name)
     from information_schema.column_privileges
    where grantee = 'authenticated' and table_schema = 'public' and privilege_type = 'UPDATE'
      and table_name in ('companies','profiles','subscriptions','company_members'))
  = array['companies.name','profiles.full_name'],
  'authenticated can UPDATE only companies.name and profiles.full_name among protected tables');

-- no function in public/private is executable by PUBLIC or anon
do $$
declare
  leaking_public text;
  leaking_anon text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ') into leaking_public
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.prokind = 'f'
    and has_function_privilege('public', p.oid, 'execute');
  if leaking_public is not null then
    raise exception 'FAIL: functions executable by PUBLIC: %', leaking_public;
  end if;
  raise notice 'PASS: no function in public/private is executable by PUBLIC';

  select string_agg(n.nspname || '.' || p.proname, ', ') into leaking_anon
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.prokind = 'f'
    and has_function_privilege('anon', p.oid, 'execute');
  if leaking_anon is not null then
    raise exception 'FAIL: functions executable by anon: %', leaking_anon;
  end if;
  raise notice 'PASS: anon cannot execute any function in public/private';
end $$;

-- every SECURITY DEFINER function pins an empty search_path
do $$
declare
  offenders text;
begin
  select string_agg(n.nspname || '.' || p.proname, ', ') into offenders
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public','private') and p.prosecdef
    and not exists (
      select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c
      where c = 'search_path=""'
    );
  if offenders is not null then
    raise exception 'FAIL: SECURITY DEFINER without empty search_path: %', offenders;
  end if;
  raise notice 'PASS: every SECURITY DEFINER function sets search_path to the empty string';
end $$;

-- operator-only functions are executable by nobody but the owner
select test.ok(
  not has_function_privilege('authenticated', 'private.grant_founder(text)', 'execute')
  and not has_function_privilege('service_role', 'private.grant_founder(text)', 'execute')
  and not has_function_privilege('authenticated', 'private.revoke_founder(text)', 'execute')
  and not has_function_privilege('service_role', 'private.revoke_founder(text)', 'execute'),
  'founder grant/revoke is not executable by any API role');

-- audit_logs is immutable even for the table owner / superuser
select test.throws($$update public.audit_logs set action = 'tampered'$$, '42501', 'audit_logs UPDATE blocked even for superuser');
select test.throws($$delete from public.audit_logs$$, '42501', 'audit_logs DELETE blocked even for superuser');
select test.throws($$truncate public.audit_logs$$, '42501', 'audit_logs TRUNCATE blocked even for superuser');

-- service_role (trusted server) can append to audit_logs but not alter or read founders
select test.service();
select test.ok(test.affected($$insert into public.audit_logs (action, metadata) values ('employee.provisioned', '{}')$$) = 1,
  'service_role can append audit events');
select test.throws($$update public.audit_logs set action = 'x'$$, '42501', 'service_role cannot update audit logs');
select test.logout();

-- helper functions work without recursion for every role that evaluates policies
select test.login(test.id('viewerA'));
select test.ok(test.count('select 1 from public.company_members') >= 1, 'company_members policy evaluates without recursion');
select test.ok(test.count('select 1 from public.table_metadata') >= 1, 'table_metadata policy evaluates without recursion');
select test.logout();

-- migrations are additive: they must not have touched pre-existing objects
select test.ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relkind = 'r'
                and c.relname not in ('profiles','founders','companies','company_members','subscriptions',
                                      'table_metadata','data_permissions','data_rows','audit_logs')),
  'migrations created only the 9 documented tables in public');

-- get_my_context key contract (mirrored by tests/unit/context.test.ts)
select test.login(test.id('adminA'));
select test.ok(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_my_context()) k)
  = array['access','company_id','company_name','company_status','current_period_end','is_founder',
          'member_status','plan','role','subscription_status','trial_ends_at','user_id'],
  'get_my_context returns exactly the documented keys');
select test.logout();
