-- M1 ROLLBACK — NOT a migration (deliberately outside supabase/migrations/ so it
-- can never be applied by `supabase db push`).
--
-- Removes ONLY the objects created by the four M1 migrations. It DESTROYS all
-- data in those tables (companies, memberships, subscriptions, tables, rows,
-- permissions, audit logs, profiles). Take a backup / snapshot first.
--
-- Safety:
--   * Refuses to run unless the session sets  app.confirm_m1_rollback = 'yes'.
--   * Uses plain DROP (no CASCADE): if anything outside M1 depends on an M1
--     object, the statement fails and the whole script aborts (it runs in one
--     transaction), leaving the database unchanged.
--   * Does not touch auth.users or any pre-existing table. If the live project
--     already had a schema named "private" with other objects in it, the final
--     DROP SCHEMA fails (restrict) and nothing is rolled back.
--
-- Usage (SQL editor / psql as the owner role):
--   set app.confirm_m1_rollback = 'yes';
--   \i supabase/rollback/20261013160000_m1_rollback.sql

begin;

do $$
begin
  if coalesce(current_setting('app.confirm_m1_rollback', true), '') <> 'yes' then
    raise exception 'Refusing to roll back M1: run "set app.confirm_m1_rollback = ''yes'';" first, after taking a backup.';
  end if;
end $$;

drop trigger on_auth_user_created on auth.users;

drop function public.register_company(text);
drop function public.get_my_context();
drop function public.authorize_export(uuid);
drop function public.founder_set_company_status(uuid, text, text);
drop function public.founder_set_subscription(uuid, text, text, timestamptz, timestamptz);

drop table public.audit_logs;
drop table public.data_rows;
drop table public.data_permissions;
drop table public.table_metadata;
drop table public.subscriptions;
drop table public.company_members;
drop table public.companies;
drop table public.founders;
drop table public.profiles;

drop function private.grant_founder(text);
drop function private.revoke_founder(text);
drop function private.handle_new_user();
drop function private.is_founder();
drop function private.is_company_member(uuid);
drop function private.is_company_admin(uuid);
drop function private.company_can_read(uuid);
drop function private.company_can_write(uuid);
drop function private.has_table_permission(uuid, text);
drop function private.shares_company_as_admin(uuid);
drop function private.accessible_table_ids(text, boolean);
drop function private.write_audit(uuid, uuid, text, text, uuid, jsonb);
drop function private.set_updated_at();
drop function private.audit_logs_immutable();

drop schema private;

commit;
