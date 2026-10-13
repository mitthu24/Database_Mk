-- READ-ONLY structural verification, to run on a Supabase project AFTER the M1
-- migrations were applied (dev first). Every row must show ok = true.
-- Mirrors tests/db/70_api_surface_audit.sql and 80_robustness.sql, which were
-- only proven on a local PostgreSQL. No row contents are read.

with m1_tables(name) as (
  values ('profiles'),('founders'),('companies'),('company_members'),('subscriptions'),
         ('table_metadata'),('data_permissions'),('data_rows'),('audit_logs')
)
select 'all 9 M1 tables exist' as check,
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and c.relname in (select name from m1_tables)) = 9 as ok
union all
select 'RLS enabled on every M1 table',
       not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                   where n.nspname = 'public' and c.relname in (select name from m1_tables) and not c.relrowsecurity)
union all
select 'anon holds no privilege on any M1 table',
       not exists (select 1 from information_schema.role_table_grants
                   where grantee = 'anon' and table_schema = 'public' and table_name in (select name from m1_tables))
union all
select 'authenticated has no table-level INSERT/UPDATE/TRUNCATE on protected tables',
       not exists (select 1 from information_schema.role_table_grants
                   where grantee = 'authenticated' and table_schema = 'public'
                     and table_name in ('companies','company_members','subscriptions','founders','audit_logs','profiles')
                     and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'))
union all
select 'nobody but the owner holds any privilege on public.founders (incl. service_role)',
       not exists (select 1 from information_schema.role_table_grants
                   where table_schema = 'public' and table_name = 'founders'
                     and grantee in ('anon','authenticated','service_role','public'))
union all
select 'service_role can only INSERT into audit_logs',
       (select coalesce(array_agg(privilege_type::text order by privilege_type::text), '{}'::text[]) from information_schema.role_table_grants
         where grantee = 'service_role' and table_schema = 'public' and table_name = 'audit_logs') = array['INSERT']
union all
select 'no function in public/private is executable by PUBLIC or anon',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public','private') and p.prokind = 'f'
                     and (has_function_privilege('public', p.oid, 'execute')
                          or has_function_privilege('anon', p.oid, 'execute'))
                     -- ignore functions that pre-existed M1 (list them via inspection query 9 first)
                     and p.proname in ('register_company','get_my_context','authorize_export',
                         'founder_set_company_status','founder_set_subscription','grant_founder','revoke_founder',
                         'handle_new_user','is_founder','is_company_member','is_company_admin','company_can_read',
                         'company_can_write','has_table_permission','shares_company_as_admin','accessible_table_ids',
                         'write_audit','set_updated_at','audit_logs_immutable'))
union all
select 'every M1 SECURITY DEFINER function pins search_path to the empty string',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public','private') and p.prosecdef
                     and p.proname in ('register_company','get_my_context','authorize_export',
                         'founder_set_company_status','founder_set_subscription','grant_founder','revoke_founder',
                         'handle_new_user','is_founder','is_company_member','is_company_admin','company_can_read',
                         'company_can_write','has_table_permission','shares_company_as_admin','accessible_table_ids',
                         'write_audit')
                     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c = 'search_path=""'))
union all
select 'operator-only functions are not executable by any API role',
       not (has_function_privilege('authenticated', 'private.grant_founder(text)', 'execute')
         or has_function_privilege('service_role',  'private.grant_founder(text)', 'execute')
         or has_function_privilege('authenticated', 'private.revoke_founder(text)', 'execute')
         or has_function_privilege('service_role',  'private.revoke_founder(text)', 'execute')
         or has_function_privilege('authenticated', 'private.write_audit(uuid,uuid,text,text,uuid,jsonb)', 'execute'))
union all
select 'signup trigger present on auth.users',
       exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created' and not tgisinternal)
union all
select 'audit_logs immutability triggers present',
       (select count(*) from pg_trigger where tgrelid = 'public.audit_logs'::regclass and not tgisinternal
         and tgname in ('audit_logs_no_update_delete','audit_logs_no_truncate')) = 2
union all
select 'no write policy on company data lacks the entitlement check',
       not exists (select 1 from pg_policies
                   where schemaname = 'public' and tablename in ('companies','table_metadata','data_permissions','data_rows')
                     and cmd in ('INSERT','UPDATE','DELETE')
                     and not (coalesce(qual,'') || coalesce(with_check,'') like '%company_can_write%'
                              or (tablename = 'data_rows' and coalesce(qual,'') || coalesce(with_check,'') ~ 'accessible_table_ids\([^)]*, true\)')))
union all
select 'schema "private" is not exposed through the REST API (check the setting below too)',
       not exists (select 1 from pg_roles r where r.rolname = 'authenticator'
                   and exists (select 1 from unnest(coalesce(r.rolconfig, '{}'::text[])) c
                               where c like 'pgrst.db_schemas=%' and c like '%private%'))
order by 1;

-- Also verify by hand (Dashboard -> Project Settings -> API -> "Exposed schemas"):
--   only "public" (and "graphql_public" if you use it). "private" must NOT be listed.
-- Then, from outside, with the project's PUBLIC anon key (expect 401/403/permission denied or []):
--   curl -s "$URL/rest/v1/companies?select=id" -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
--   curl -s "$URL/rest/v1/rpc/get_my_context"  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" -X POST
--   curl -s "$URL/rest/v1/founders?select=*"   -H "apikey: $ANON" -H "Authorization: Bearer $ANON"
