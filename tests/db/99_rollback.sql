-- Rollback script removes exactly the M1 objects (run last: it destroys the fixtures).
-- (The refusal-without-confirmation check is done by scripts/test-db.sh.)

set app.confirm_m1_rollback = 'yes';
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

select test.ok((select count(*) from auth.users) = 10,
  'rollback left auth.users untouched (10 fixture users still present)');
