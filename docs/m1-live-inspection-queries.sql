-- READ-ONLY inspection of the live Supabase project (evgwjbyrmuljrccgtedi).
-- Run in the Supabase SQL editor or through a read-only MCP session, and paste
-- the RESULTS into docs/m1-live-schema-review.md. Every statement is a SELECT.
-- No row contents are read from user tables: only catalog metadata and counts.

-- 0. Identity: confirm this is the intended project (compare with the dashboard URL).
select current_database() as db, current_user as role, version();

-- 1. Schemas (is there already a "private" schema? M1 creates one).
select nspname from pg_namespace
where nspname not like 'pg\_%' and nspname <> 'information_schema' order by 1;

-- 2. Tables in public, with RLS state and approximate size.
select c.relname as table_name,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       c.reltuples::bigint as approx_rows
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p') order by 1;

-- 3. NAME COLLISIONS with M1 (any row here means a migration will fail or must be adapted).
select n.nspname, c.relname, c.relkind
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('profiles','founders','companies','company_members','subscriptions',
                    'table_metadata','data_permissions','data_rows','audit_logs');

select n.nspname, p.proname
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where (n.nspname = 'public' and p.proname in
        ('register_company','get_my_context','authorize_export','founder_set_company_status','founder_set_subscription'))
   or n.nspname = 'private';

-- 4. Columns of every public table.
select table_name, ordinal_position, column_name, data_type, is_nullable, column_default
from information_schema.columns where table_schema = 'public' order by table_name, ordinal_position;

-- 5. Constraints (PK, FK, unique, check).
select conrelid::regclass as table_name, conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2;

-- 6. Indexes.
select tablename, indexname, indexdef from pg_indexes where schemaname = 'public' order by 1, 2;

-- 7. RLS policies.
select tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by 1, 2;

-- 8. Table grants to API roles (look for anon / authenticated write access).
select table_name, grantee, string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated','service_role')
group by 1, 2 order by 1, 2;

-- 9. Functions in public (security definer? search_path pinned?).
select p.proname, p.prosecdef as security_definer, p.proconfig, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' order by 1;

-- 10. Triggers on auth.users and on public tables (an existing "create profile" trigger would clash).
select tgrelid::regclass as table_name, tgname, pg_get_triggerdef(oid) as definition
from pg_trigger
where not tgisinternal
  and (tgrelid = 'auth.users'::regclass or tgrelid::regclass::text like 'public.%')
order by 1, 2;

-- 11. Extensions.
select extname, extversion from pg_extension order by 1;

-- 12. Migration history, if the project uses the Supabase CLI.
select version, name from supabase_migrations.schema_migrations order by version;

-- 13. Existing auth users: COUNT ONLY (needed to size the profile backfill).
select count(*) as auth_users,
       count(*) filter (where email_confirmed_at is not null) as confirmed
from auth.users;

-- 14. Existing public.profiles-like data that M1 must preserve (count only).
-- select count(*) from public.profiles;   -- uncomment only if the table exists (see query 3)

-- Auth configuration is NOT in SQL. Read it in Dashboard -> Authentication:
--   Providers -> Email (confirm email? secure password change? min password length)
--   URL Configuration (Site URL, Redirect URLs)
--   Rate Limits, Attack Protection (CAPTCHA / leaked-password protection)
