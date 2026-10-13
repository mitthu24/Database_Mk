-- Rollback script removes exactly the M1 objects (run last: it destroys the fixtures).
-- (The refusal-without-confirmation check is done by scripts/test-db.sh.)

select count(*) as users_before from auth.users \gset
select count(*) as rows_before from public.data_rows \gset

-- M2+ rollback first: the M1 rollback must refuse while newer objects depend on its tables
set app.confirm_m1_rollback = 'yes';
set app.confirm_m2_rollback = 'yes';
\ir ../../supabase/rollback/20261013170000_m2_rollback.sql

select test.ok(
  not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = 'public' and c.relname in ('import_jobs', 'manual_payments', 'platform_settings'))
  and not exists (select 1 from information_schema.columns where table_schema = 'public'
                  and ((table_name = 'table_metadata' and column_name = 'data_updated_at')
                    or (table_name = 'companies' and column_name in ('contact_email', 'phone', 'address')))),
  'M2+ rollback removed its tables and added columns');
select test.ok(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname in ('public', 'private')
                and p.proname in ('query_rows', 'import_rows', 'list_tables', 'submit_manual_payment',
                                  'founder_overview', 'add_company_member', 'accessible_table_ids_x', 'row_error', 'match_filter')),
  'M2+ rollback removed its functions');
select test.ok((select count(*) from public.data_rows) = :rows_before, 'M2+ rollback kept every customer row (data_rows untouched)');
select test.ok(exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = 'founder_set_subscription')
               and exists (select 1 from pg_trigger where tgname = 'set_updated_at'
                           and tgrelid = 'public.table_metadata'::regclass),
  'M1 behaviour restored (founder_set_subscription, plain updated_at trigger)');

\ir ../../supabase/rollback/20261013160000_m1_rollback.sql

select test.ok(
  not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ('profiles','founders','companies','company_members','subscriptions',
                        'table_metadata','data_permissions','data_rows','audit_logs')),
  'rollback removed all M1 tables');

select test.ok(not exists (select 1 from pg_namespace where nspname = 'private'),
  'rollback removed the private schema and every function in it');

select test.ok(
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname in
                ('register_company','get_my_context','authorize_export','founder_set_company_status','founder_set_subscription')),
  'rollback removed the public RPC functions');

select test.ok(not exists (select 1 from pg_trigger where tgname = 'on_auth_user_created'),
  'rollback removed the auth.users trigger');

select test.ok((select count(*) from auth.users) = :users_before,
  'rollback left auth.users untouched (same user count before and after)');
