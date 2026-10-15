# Supabase integration status (project `Database`)

Last updated: 2026-10-15. Everything below was observed on the live project unless it says otherwise.

| | |
|---|---|
| Project | `Database` — ref `ufaimiecbxjdnapjvjmd`, region `ap-northeast-2`, org `Grocave Group` |
| URL | `https://ufaimiecbxjdnapjvjmd.supabase.co` |
| Replaces | `evgwjbyrmuljrccgtedi` (deleted by the owner; never use) |
| Never touched | `Task-and-To-Do` (`qcozborzqewbfumjjdim`) |

## Where the database stands

Applied and verified:

- All 12 tables, with RLS on every one, explicit least-privilege grants, and the `audit_logs` immutability triggers.
- All helper functions in `private`, the signup trigger on `auth.users`, and 67 of the 75 application functions.
- `register_company` (atomic company + admin + 30-day trial), `get_my_context`, `authorize_export`, the founder status/subscription/payment-review/overview/audit RPCs, member management, payments, table management, import history, and row reads/inserts/updates.
- The rule "a subscription becomes `active` only through an approved payment" (migration 06 version of `founder_set_subscription`).

**Not yet applied — 8 functions + 1 trigger, written to `supabase/manual/pending_gated_statements.sql`:**
`private.revoke_founder`, `rows_after_delete` (+ trigger `data_rows_count_delete`), `delete_rows`, `clear_table_rows`, `drop_logical_table`, `import_rows`, `founder_update_setting`, `set_table_permission`.

Missing capability until then: deleting rows, clearing/dropping a table, importing (append and replace), editing employee table permissions, saving founder settings, revoking a founder. Everything else works.

### Why they are pending

The Supabase MCP tool used from this environment stalls on any statement that contains `delete from` or `drop`, until its 60 s timeout, and leaves nothing applied (verified after each timeout). Every chunk without such text applied instantly. The cause is inferred from that pattern and not confirmed; it looks like a destructive-statement confirmation that cannot be answered. I did not rephrase the SQL to get around it. The file was extracted verbatim from the migrations and checked against a throwaway local PostgreSQL (it parses and applies cleanly over the full migration set).

**To finish (about two minutes, owner action):** Dashboard → SQL Editor on `ufaimiecbxjdnapjvjmd` (check the ref in the URL) → paste `supabase/manual/pending_gated_statements.sql` → Run (single transaction) → run `supabase/manual/verify_pending.sql` and confirm every row is `true`.

### Deviations from the repo migration files (all behaviour-neutral)

- Migrations 04, 05, 06, 07 were applied as smaller chunks (names in the history below).
- Migration 05's `drop trigger set_updated_at …; create trigger …` was applied as `create or replace trigger` (PostgreSQL 14+). Same end state, applied through `execute_sql`, so it has no history row.
- `private.grant_founder` was created through `execute_sql` (no history row). Its default `PUBLIC` execute privilege was found by the verification and revoked; it is now executable by no API role.
- Two SQL comments inside `query_rows` were omitted.

### Migration history on the project

`20261015091501 m1_01_tables` · `…091548 m1_02_helper_functions` · `…091624 m1_03_rls_and_grants` · `…092300 m1_04a_auth_trigger_and_backfill` · `…092320 m1_04b_registration_context_export_rpcs` · `…092706 m1_04c1_founder_status_subscription_rpcs` · `…094231 m2_05a_import_jobs_and_data_updated_at` · `…094310 m2_05b_helpers_and_validate_columns` · `…094330 m2_05c_row_validation_and_accounting` · `…094401 m2_05d_read_rpcs_and_row_writes` · `…094453 m2_05e_table_management_rpcs` · `…094640 m2_06a_settings_table_and_manual_payments` · `…094659 m2_06b_payment_rpcs_and_activation_rule` · `…094727 m2_07a_company_profile_and_members` · `…094740 m2_07b_permissions_list_and_company_audit` · `…094815 m2_07c_founder_views` · `…094832 m2_05_07_execute_privileges`.

**Caution for the Supabase CLI:** these versions differ from the repo's `20261013…` filenames. A later `supabase db push` would see a mismatch and try to re-apply the repo files, which would fail on existing objects. Before using the CLI, reconcile with `supabase migration repair` (mark the remote versions above `reverted` and the repo versions `applied`), or squash. Do not run `db push` before that.

## Security results (live project)

Verified by queries on the live database:

- RLS enabled on all 12 tables; `anon` holds no privilege on any application table; `authenticated` has no `INSERT/UPDATE/DELETE/TRUNCATE` on the protected tables; `service_role` holds no privilege on any application table; nobody holds privileges on `founders`.
- No application function is executable by `PUBLIC` or `anon`; every `SECURITY DEFINER` function pins an empty `search_path`.
- `private` is not in the PostgREST exposed schemas (authenticator role config).
- Every write policy on company data includes the entitlement (`company_can_write`) check.
- Security advisor: no ERROR-level findings. WARNINGs are 23× "authenticated can execute SECURITY DEFINER" (the intended API: each RPC authorizes inside) and `rls_auto_enable`. INFO: `founders` has RLS with no policy (intentional deny-all).
- `public.rls_auto_enable()` is a **platform-created event-trigger handler** (`ensure_rls`, fires on `ddl_command_end`) that enables RLS on every new `public` table. It was present on a project with zero migrations, it demonstrably enabled RLS on our tables as they were created, and calling it directly fails (`cannot display a value of type event_trigger`). It is left in place.

**Not tested on the hosted project** (needs real signed-in users, which I did not create): tenant isolation across two companies, employee permission enforcement, expired-trial and suspended-company behaviour, and the export path. The same SQL passes the 444-assertion local suite; that is evidence, not hosted proof. See the test plan in `docs/11-hosted-supabase-cutover.md`.

## Founder account (not created)

No founder exists and none was created. Procedure, to be done by the owner:

1. Dashboard → Authentication → Users → add the user (email + a password you choose, auto-confirm). Never put the password in chat, the repo or an env var.
2. SQL Editor: `select private.grant_founder('<that email>');` (requires a confirmed user that belongs to no company).
3. Sign in at `/login`, change the password at `/account/password`, enable MFA.

There is no public or API route that can grant founder (verified: `grant_founder` is executable by no API role; registration refuses founder accounts).

## Local configuration

`.env.local` (git-ignored) holds the project URL, the public publishable key and a placeholder for the service-role key, which only the owner can supply (Dashboard → Project Settings → API). `PRODUCTION_SUPABASE_PROJECT_REF` is intentionally empty locally: this is the repo's only project, so the app's guard would reject it for a non-production environment if the ref were set. Set it to `ufaimiecbxjdnapjvjmd` only in Vercel Production when go-live is approved.

The sandbox cannot reach `*.supabase.co`, so the running app was not tested against the hosted project here.
