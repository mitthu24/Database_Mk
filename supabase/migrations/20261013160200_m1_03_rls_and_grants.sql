begin;

-- M1 / 03 — Row Level Security, policies and privileges.
--
-- STATUS: DRAFT — NOT APPLIED. See 01 for the review gate.
--
-- Model:
--  * RLS is ENABLED on every table below and there is no default-allow policy.
--  * Privileges are revoked per table (never schema-wide, so unrelated live
--    tables are untouched), then re-granted minimally. Column-level grants
--    stop admins editing protected columns even where an UPDATE policy exists.
--  * Clients have NO insert/update/delete on companies, company_members,
--    subscriptions, founders, audit_logs. Those change only through the
--    SECURITY DEFINER RPCs in 04 or the trusted server (service_role).
--  * The founder is never granted access to customer data (table_metadata,
--    data_rows, data_permissions) — the founder surface is platform management.
--  * Policies use (select auth.uid()) via the helpers so Postgres evaluates it
--    once per statement.

alter table public.profiles          enable row level security;
alter table public.founders          enable row level security;
alter table public.companies         enable row level security;
alter table public.company_members   enable row level security;
alter table public.subscriptions     enable row level security;
alter table public.table_metadata    enable row level security;
alter table public.data_permissions  enable row level security;
alter table public.data_rows         enable row level security;
alter table public.audit_logs        enable row level security;

-- Start from zero privileges on our tables, for EVERY API role, and grant back
-- only what is needed. This does not rely on Supabase default grants, which no
-- longer exist for new public tables (new projects since 2026-05-30, all
-- projects 2026-10-30) and which, before that, over-granted. service_role
-- bypasses RLS but NOT table privileges, so limiting it is real defence in depth
-- against a leaked service-role key.
revoke all on public.profiles, public.founders, public.companies,
              public.company_members, public.subscriptions, public.table_metadata,
              public.data_permissions, public.data_rows, public.audit_logs
  from public, anon, authenticated, service_role;
revoke all on sequence public.audit_logs_id_seq, public.data_rows_row_order_seq
  from public, anon, authenticated, service_role;

-- service_role (trusted server only) gets NO table privileges. The server uses
-- it solely to create/invite auth users through the Auth admin API; everything
-- that touches company data goes through SECURITY DEFINER RPCs called with the
-- acting user's own JWT, so the database re-verifies the caller every time
-- (e.g. add_company_member checks the caller is an admin of a writable company).
-- A leaked service-role key therefore cannot read or write any customer table.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy profiles_select_company_admin on public.profiles
  for select to authenticated
  using (private.shares_company_as_admin(id));

create policy profiles_select_founder on public.profiles
  for select to authenticated
  using (private.is_founder());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- companies — admins may rename only; status is founder-RPC only
-- ---------------------------------------------------------------------------
grant select on public.companies to authenticated;
grant update (name) on public.companies to authenticated;

create policy companies_select on public.companies
  for select to authenticated
  using (private.is_company_member(id) or private.is_founder());

create policy companies_update_admin on public.companies
  for update to authenticated
  using (private.is_company_admin(id) and private.company_can_write(id))
  with check (private.is_company_admin(id) and private.company_can_write(id));

-- ---------------------------------------------------------------------------
-- company_members — read-only for clients
-- ---------------------------------------------------------------------------
grant select on public.company_members to authenticated;

create policy company_members_select on public.company_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or private.is_company_admin(company_id)
    or private.is_founder()
  );

-- ---------------------------------------------------------------------------
-- subscriptions — read-only for clients; admins may read, employees may not
-- ---------------------------------------------------------------------------
grant select on public.subscriptions to authenticated;

create policy subscriptions_select on public.subscriptions
  for select to authenticated
  using (private.is_company_admin(company_id) or private.is_founder());

-- ---------------------------------------------------------------------------
-- table_metadata
-- ---------------------------------------------------------------------------
grant select on public.table_metadata to authenticated;
grant insert (company_id, name, columns) on public.table_metadata to authenticated;
grant update (name, columns) on public.table_metadata to authenticated;
grant delete on public.table_metadata to authenticated;

create policy table_metadata_select on public.table_metadata
  for select to authenticated
  using (
    private.company_can_read(company_id)
    and (private.is_company_admin(company_id) or private.has_table_permission(id, 'view'))
  );

create policy table_metadata_insert on public.table_metadata
  for insert to authenticated
  with check (private.is_company_admin(company_id) and private.company_can_write(company_id));

create policy table_metadata_update on public.table_metadata
  for update to authenticated
  using (private.is_company_admin(company_id) and private.company_can_write(company_id))
  with check (private.is_company_admin(company_id) and private.company_can_write(company_id));

create policy table_metadata_delete on public.table_metadata
  for delete to authenticated
  using (private.is_company_admin(company_id) and private.company_can_write(company_id));

-- ---------------------------------------------------------------------------
-- data_permissions — admins manage; employees read their own grants
-- (no sub-select on table_metadata => no cross-table policy recursion)
-- ---------------------------------------------------------------------------
grant select on public.data_permissions to authenticated;
grant insert (company_id, user_id, table_id, can_view, can_create, can_edit, can_delete, can_import, can_export)
  on public.data_permissions to authenticated;
grant update (can_view, can_create, can_edit, can_delete, can_import, can_export)
  on public.data_permissions to authenticated;
grant delete on public.data_permissions to authenticated;

create policy data_permissions_select on public.data_permissions
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_company_admin(company_id));

create policy data_permissions_insert on public.data_permissions
  for insert to authenticated
  with check (private.is_company_admin(company_id) and private.company_can_write(company_id));

create policy data_permissions_update on public.data_permissions
  for update to authenticated
  using (private.is_company_admin(company_id) and private.company_can_write(company_id))
  with check (private.is_company_admin(company_id) and private.company_can_write(company_id));

create policy data_permissions_delete on public.data_permissions
  for delete to authenticated
  using (private.is_company_admin(company_id) and private.company_can_write(company_id));

-- ---------------------------------------------------------------------------
-- data_rows — admin implicit, employees need the matching per-table grant
-- ---------------------------------------------------------------------------
grant select on public.data_rows to authenticated;
grant insert (company_id, table_id, data) on public.data_rows to authenticated;
grant update (data) on public.data_rows to authenticated;
grant delete on public.data_rows to authenticated;

-- Each policy is a single uncorrelated "table_id in (select …)" so the access
-- decision is computed once per statement (see private.accessible_table_ids).
-- company_id/table_id consistency is additionally enforced by the composite FK.
create policy data_rows_select on public.data_rows
  for select to authenticated
  using (table_id in (select private.accessible_table_ids('view', false)));

create policy data_rows_insert on public.data_rows
  for insert to authenticated
  with check (table_id in (select private.accessible_table_ids('create', true)));

create policy data_rows_update on public.data_rows
  for update to authenticated
  using (table_id in (select private.accessible_table_ids('edit', true)))
  with check (table_id in (select private.accessible_table_ids('edit', true)));

create policy data_rows_delete on public.data_rows
  for delete to authenticated
  using (table_id in (select private.accessible_table_ids('delete', true)));

-- ---------------------------------------------------------------------------
-- audit_logs — company admins read their company's; founder reads all
-- ---------------------------------------------------------------------------
grant select on public.audit_logs to authenticated;

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (
    (company_id is not null and private.is_company_admin(company_id))
    or private.is_founder()
  );

commit;
