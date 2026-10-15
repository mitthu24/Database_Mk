-- READ-ONLY. Run in the SQL editor of project ufaimiecbxjdnapjvjmd AFTER
-- pending_gated_statements.sql. Every row must show ok = true.

with expected(name) as (
  values ('revoke_founder'),('rows_after_delete'),('delete_rows'),('clear_table_rows'),
         ('drop_logical_table'),('import_rows'),('founder_update_setting'),('set_table_permission')
)
select 'all 8 pending functions exist' as check,
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname in ('public','private') and p.proname in (select name from expected)) = 8 as ok
union all
select 'delete trigger on data_rows present',
       exists (select 1 from pg_trigger where tgrelid = 'public.data_rows'::regclass
                 and tgname = 'data_rows_count_delete' and not tgisinternal)
union all
select 'revoke_founder not executable by any API role',
       not (has_function_privilege('anon', 'private.revoke_founder(text)', 'execute')
         or has_function_privilege('authenticated', 'private.revoke_founder(text)', 'execute')
         or has_function_privilege('service_role', 'private.revoke_founder(text)', 'execute'))
union all
select 'public RPCs executable by authenticated only (not anon)',
       has_function_privilege('authenticated', 'public.delete_rows(uuid,uuid[])', 'execute')
       and has_function_privilege('authenticated', 'public.import_rows(uuid,text,jsonb,text)', 'execute')
       and not has_function_privilege('anon', 'public.delete_rows(uuid,uuid[])', 'execute')
       and not has_function_privilege('anon', 'public.import_rows(uuid,text,jsonb,text)', 'execute')
union all
select 'every SECURITY DEFINER function pins an empty search_path (except platform rls_auto_enable)',
       not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public','private') and p.prosecdef and p.proname <> 'rls_auto_enable'
                     and not ('search_path=""' = any(coalesce(p.proconfig, '{}'::text[]))))
order by 1;
