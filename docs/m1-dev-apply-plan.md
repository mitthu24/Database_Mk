# M1 development apply plan — for your written approval

Status: **nothing has been applied.** No auth users, founder, policies or test data exist anywhere. This document is the package you approve (or amend) before any write. Prepared at commit following `9ad4117` on `claude/optimistic-cerf-yd7cvu`.

## 1. Development project reference
**Not verified — not provided.** No development project ref is documented in the repository, no Supabase MCP is connected, and the build environment's egress proxy rejects `supabase.com`, `mcp.supabase.com`, `api.supabase.com` and `*.supabase.co` (re-checked this session). The production project `evgwjbyrmuljrccgtedi` must not be used for any of this.

I need from you: the 20-character ref of the dedicated development project (`DEV_REF`), plus confirmation it is **not** `evgwjbyrmuljrccgtedi`. If it does not exist yet: Dashboard → *New project*. Creating a project can be billable depending on your plan and how many projects the organization already has; check the dashboard's cost notice yourself before creating it. Branching is a separate, paid, production-linked feature and is not needed.

## 2. Existing schema summary
**Unknown — inspection blocked.** Nothing about the live schema, auth settings, triggers, grants or policies has been read. Run `docs/m1-live-inspection-queries.sql` (SELECT-only) on the dev project and I will write `docs/m1-live-schema-review.md` from the results. Expectation for a brand-new project (to be confirmed, not assumed): only Supabase-managed schemas, empty `public`, no `private` schema, no migration history.

## 3. Migration compatibility review

### Verified locally (real tools, local PostgreSQL only)
| Question | Result |
|---|---|
| Does the **real Supabase CLI** (2.120.0) apply the four files? | Yes: `db push` applied 01→04, wrote 4 history rows, created 9 tables. Re-push: "up to date" |
| Are explicit `BEGIN`/`COMMIT` compatible with the runner? | Yes. Files with their own transaction control run sequentially with their boundaries respected (per the discussion on upstream PR #6354, and observed here) |
| Partial application on failure? | No. A forced collision on the 5th table of file 01 failed at the right statement and left **0 tables, no `private` schema, 0 history rows**. Same result via `psql` |
| Is the history ever out of sync? | Only in a narrow window: CLI source review (upstream issue #6959, open, unreproduced) says the history row is written *after* a self-transactional file commits, so a connection loss between the two could leave "applied but unrecorded". Because the migrations are strict (no `if not exists`), a blind re-apply fails loudly instead of corrupting. Tested: the CLI refuses the out-of-order history, and `supabase migration repair --status applied <version>` fixes it |
| Works when Supabase does **not** auto-grant to API roles? | Yes. Supabase now makes new `public` tables opt-in for the Data API (new projects since 2026-05-30; all projects 2026-10-30, per the Supabase changelog). The suite runs in **both** modes (no default grants / legacy grants): 453 assertions pass |
| Server-side provisioning without default grants? | A real bug was found and fixed: `service_role` previously relied on default grants and got `permission denied for table company_members` on a fresh project. It now holds exactly `company_members` S/I/U/D + `audit_logs` INSERT (pinned by test); it can no longer read customer data |
| Function hardening, RLS, grants | `SECURITY DEFINER` functions have `search_path=""`; `EXECUTE` revoked from `PUBLIC`/`anon`; RLS on all 9 tables; column-level write grants; all asserted structurally and behaviourally |
| Isolation, suspension, expired trial, atomic registration, audit immutability, rollback | All covered by the suite (see `m1-validation-checkpoint.md`); the same 220 assertions also pass on the schema applied **by the real CLI** |

### Not verifiable until the dev project is reachable
- Hosted `postgres` role may create the trigger on `auth.users` (documented Supabase pattern; unconfirmed here).
- `private` is not in the project's *Exposed schemas*.
- Real PostgREST role switching, JWT claims, GoTrue writing `auth.users`, email flows.
- Your CLI version: the runner behaviour above was tested with 2.120.0. Re-run `npm run test:cli-runner` if you use another version (it needs only Node and PostgreSQL server binaries).
- How the SQL editor wraps multi-statement scripts (use the CLI, not the editor, to apply).

## 4. Exact planned database changes (additive only)
Applied by four files, each `begin; … commit;`, in this order:

| File | Creates |
|---|---|
| `20261013160000_m1_01_tables` | schema `private`; tables `profiles`, `founders`, `companies`, `company_members`, `subscriptions`, `table_metadata`, `data_permissions`, `data_rows`, `audit_logs` (counts measured on local PostgreSQL 16: 9 PK, 12 FK, 5 UNIQUE, 15 CHECK constraints; 21 indexes); `updated_at` triggers on 7 tables; audit-log immutability triggers (UPDATE/DELETE/TRUNCATE blocked) |
| `20261013160100_m1_02_helper_functions` | 9 functions in `private`: `is_founder`, `is_company_member`, `is_company_admin`, `company_can_read`, `company_can_write`, `has_table_permission`, `shares_company_as_admin`, `accessible_table_ids`, `write_audit`, with restricted `EXECUTE` (the 14 `private` functions in total also include 2 trigger functions from 01 and 3 from 04) |
| `20261013160200_m1_03_rls_and_grants` | RLS enabled on 9 tables; **21 policies** (audit_logs 1, companies 2, company_members 1, data_permissions 4, data_rows 4, profiles 4, subscriptions 1, table_metadata 4); per-table `REVOKE ALL` from `PUBLIC, anon, authenticated, service_role` then minimal grants; two M1 sequences locked down |
| `20261013160300_m1_04_auth_triggers_and_rpcs` | trigger `on_auth_user_created` on `auth.users`; `private.handle_new_user`, `private.grant_founder`, `private.revoke_founder`; public RPCs `register_company`, `get_my_context`, `authorize_export`, `founder_set_company_status`, `founder_set_subscription`; **data effect:** one `profiles` row inserted per existing `auth.users` row (a fresh project: normally 0) |

Total: 1 schema, 9 tables, 14 `private` + 5 `public` functions, 10 triggers, 21 policies.

**Not touched:** existing tables, existing functions, auth settings, extensions, storage, Realtime, schemas other than `private`; no `alter default privileges`; no seed data; no auth users; no founder.

## 5. Backup and recovery plan
1. **Before applying:** confirm what the dev project holds. If it is empty, a backup is optional. If it holds anything you want, take a dashboard backup (availability depends on plan) or `pg_dump` from your terminal with the connection string (keep the dump outside Git).
2. **If `db push` fails:** each file is atomic, so nothing partial remains. Read the error (it names the statement), fix the cause, re-run `supabase db push`.
3. **If a file applied but the history is missing** (the #6959 window): `supabase migration repair --status applied <version>`, then `supabase db push` must report "up to date".
4. **Rollback of M1:** export `audit_logs` first (the rollback destroys it), then in the SQL editor `set app.confirm_m1_rollback = 'yes';` and run `supabase/rollback/20261013160000_m1_rollback.sql`. It refuses without the setting, uses plain `DROP` (no CASCADE) in one transaction, leaves `auth.users` untouched. Tested locally in both modes.
5. **Worst case:** the dev project holds no real data; delete and recreate it.
Production is out of scope; once real customer data exists, prefer forward-fix migrations over rollback.

## 6. Commands (run from your own terminal; secrets never go into chat)
```bash
# one-time
supabase login                                   # browser OAuth, or export SUPABASE_ACCESS_TOKEN in your shell
supabase init                                    # creates supabase/config.toml; set [db] major_version to the project's Postgres version; commit it
supabase link --project-ref <DEV_REF>            # confirm the printed project NAME is the development project
                                                 # (db password via prompt or SUPABASE_DB_PASSWORD env var)

# gate: only after you send the approval below
supabase db push --dry-run                       # must list exactly the four m1_0{1..4} files
supabase db push                                 # applies 01 → 04

# right afterwards
#  - SQL editor: run docs/m1-post-apply-verification.sql  → every row must be true
#  - Dashboard → Project Settings → API → Exposed schemas: "private" must NOT be listed
```
`supabase/.temp/` (written by `link`) is git-ignored.

## 7. Integration tests that run after the apply (still dev only)
Written and executed only after step 6, in `tests/integration/` (Vitest + supabase-js), guarded so they refuse to run unless the URL host equals `INTEGRATION_TEST_CONFIRM_REF` and differs from `PRODUCTION_SUPABASE_PROJECT_REF`:
- real signup → trigger creates the profile; hostile signup metadata ignored; signup works for the auth service role
- company registration through the RPC: atomic, confirmed-email required, 30-day trial from the server clock
- two companies × admin / employee(edit) / employee(view-only) / employee(view+export) / no-grant / founder / anon: cross-tenant read, write and IDOR in both directions
- suspension, expired trial (dates set in SQL), paid and lapsed states; every write path
- `authorize_export`, `get_my_context`, audit-log immutability; `service_role` limited to its two tables
- REST probes with only the public anon key: no data, no founders, no RPC
- Auth flow checklist (`m1-dev-deployment-procedure.md` §7): email confirmation, login, session refresh, logout, password change (other sessions revoked)
- rollback drill and re-apply
Test users are created with the service-role key under a unique prefix and deleted afterwards.

## Approval needed
Reply with exactly: **"Apply M1 migrations 01–04 to development project `<DEV_REF>`."** (with the real ref). Until then I will not apply migrations, create users, create the founder, change policies, or perform test writes.
