# M1 — Database, Authentication & Security Foundation: implementation notes

Branch `claude/optimistic-cerf-yd7cvu`. Last updated for the M1 preparation pass.

## 1. Status at a glance

| Area | State |
|---|---|
| Migrations written (4 files + rollback) | Done, **not applied anywhere** |
| Migrations tested | Yes — on a throwaway **local PostgreSQL 16** with a Supabase emulation harness (see `m1-validation-checkpoint.md` for the audit and results) |
| Live Supabase project verified (`ufaimiecbxjdnapjvjmd`) | **No — blocked** (see §2) |
| Live schema inspected / `m1-live-schema-review.md` | **Not done** — cannot be done without access; not fabricated |
| Auth UI + server actions + route protection | Implemented; build, typecheck, lint, unit tests pass |
| Auth flows exercised against real Supabase Auth | **No** (no network path to Supabase) |
| Founder account created | **No** — requires your explicit approval after the project is verified |
| Anything applied to a database, deployed, or pushed to production | **No** |

## 2. Blocker: Supabase is unreachable from the build environment

- No Supabase MCP server is configured or connected in this session (`claude mcp list`, no `.mcp.json`).
- The environment's egress proxy rejects `supabase.com`, `mcp.supabase.com` and `ufaimiecbxjdnapjvjmd.supabase.co` (`connect_rejected`, organization policy).
- Consequence: project identity, existing schema, auth configuration, RLS and grants are all **unverified**. The migrations were written against the proposed design only.

To unblock Phase 2:
1. Allow `*.supabase.com` and `*.supabase.co` in the environment's network settings, **or** run the inspection yourself.
2. Connect the Supabase MCP to a **development** project (see `docs/m1-dev-deployment-procedure.md`). `read_only=true` only "excludes mutating tools" per the official `supabase/mcp` README; it is **not** a proven database-level guarantee — verify it with a harmless write on the dev project and approve tool calls manually.
3. Run `docs/m1-live-inspection-queries.sql` (all `SELECT`s) and use the results to write `docs/m1-live-schema-review.md`.

## 3. Approved-for-review design decisions (deviations from `docs/03`)

| Decision | Why |
|---|---|
| Trial/plan dates live in `subscriptions`; `companies` holds identity + `status` only | One source of truth; admins cannot touch either, but the split keeps suspension (founder) separate from billing |
| `import_jobs` and `manual_payments` **deferred** (M4 / M6) | Not needed for the M1 security foundation; avoids speculative tables |
| `table_metadata`, `data_permissions`, `data_rows` **included** in M1 | Tenant isolation and employee permissions cannot be proven without them |
| A user belongs to **one company** (`unique(user_id)`) | Simplest safe MVP model; relaxing it later needs app changes anyway |
| Granular permissions: view / create / edit / delete / import / export per employee per table | Required by Phase 8; export/import/delete/etc. imply `can_view` (CHECK constraint) |
| Composite FKs `(table_id, company_id)` and `(company_id, user_id)` | Cross-tenant rows (a permission or data row pointing at another company's table/user) are structurally impossible, not just policy-blocked |
| Helper functions in a non-exposed `private` schema | They cannot be called as API endpoints; only RLS uses them |
| `service_role` is limited to `company_members` (S/I/U/D) and `audit_logs` (INSERT); no customer-data access | Supabase no longer auto-grants new tables; least privilege if the service key leaks |
| Customer tables stay **logical**: metadata + JSONB rows, no per-customer physical tables | As in `docs/03` |
| Audit log has no FK to companies/users and is append-only (privileges + trigger) | History survives deletions and cannot be rewritten by anyone, including service_role |

## 4. Authentication flow

Pages: `/register`, `/login`, `/auth/callback`, `/onboarding`, `/dashboard`, `/account/password`, `/founder`.

- **Registration** (`signUp` action): validates with Zod, calls `supabase.auth.signUp` with only `full_name` and a *suggested* company name in metadata. Roles, company ids and trial dates are never accepted from the browser; the DB trigger copies only `full_name`.
  - Email confirmation **on** (recommended): user sees a generic "check your email" message (identical for new and existing addresses, to avoid account enumeration). The link goes to `/auth/callback?code=…` (PKCE code exchange; `next` is restricted to same-origin paths), then `/onboarding` where the user confirms the company name and the company is created.
  - Email confirmation **off**: the session exists immediately, so the company is created in the same action.
- **Company creation** is always the `register_company(name)` RPC, called by the authenticated user (see §5).
- **Login** (`signIn`): `signInWithPassword`; one generic error for wrong email/password; `next` validated by `safeNextPath`.
- **Logout** (`signOut`): clears the Supabase session cookies server-side.
- **Password change** (`changePassword`): requires the current password. It is verified on a throwaway stateless client (so the live session is untouched), then `updateUser` runs and `signOut({ scope: 'others' })` revokes every other session.
- **Session handling**: `@supabase/ssr` cookies; `src/proxy.ts` refreshes the session and does **optimistic** redirects only (`getClaims`). Real authorization is the DAL (`src/lib/auth/dal.ts`): `getUser()` against the Auth server + `get_my_context()` from the database; the result must match the verified user id or access is denied. Every page and Server Action re-checks; nothing relies on the proxy or the layout.
- **Cache Components**: all request-time reads (`cookies()`, `searchParams`) sit behind `<Suspense>`; protected routes build as partial prerenders.

## 5. Company registration and free trial

`public.register_company(p_name)` — `SECURITY DEFINER`, `search_path=''`, executable by `authenticated` only. In one transaction it: checks the caller is authenticated, has a **confirmed email**, is not a founder, and has no company yet; then inserts the company, the **admin** membership and the **subscription** (`status='trialing'`, `trial_started_at=now()`, `trial_ends_at=now()+30 days` from column defaults), and writes an audit row. Any failure rolls back everything (tested by forcing the last insert to fail). Clients have no INSERT privilege on `companies`, `company_members` or `subscriptions`.

### What happens when access ends (implemented and tested)

| State | Reads | Writes | Notes |
|---|---|---|---|
| Trialing (or paid & current) | per permissions | per permissions | `access = full` |
| **Trial expired / subscription canceled / past due / period lapsed** | allowed (admin + granted employees), export gate still passes | **all rejected** (rows, tables, permissions, rename) | `access = read_only`; evaluated at query time, **no cron job**; founder restores by setting a paid subscription |
| **Suspended** (founder action) | rejected for everyone in the company | rejected | company/subscription rows stay visible so the UI can explain why; `access = suspended` |
| Member disabled | none | none | `access = disabled` |

> **Decision needed from you:** read-only after expiry (so customers can retrieve data and pay) is my default, not a requirement you stated. It is a one-function change (`private.company_can_read/write`) if you prefer a hard lock or a grace period.

## 6. Founder provisioning (out-of-band; nothing created yet)

The requested development founder email is `admin@gmail.com`. The requested temporary password is deliberately **not written anywhere in this repository or its history** and must never be committed. It is shorter than the app's own 10-character password policy; creating the user in the Supabase dashboard bypasses that policy, so treat it as dev-only and replace it immediately.

After the project is verified and **you approve**:
1. Dashboard → Authentication → Users → *Add user* → email `admin@gmail.com`, enter the temporary password yourself, tick **Auto Confirm User**.
2. SQL editor (runs as `postgres`; no API role can execute this): `select private.grant_founder('admin@gmail.com');`
   - It requires an existing **confirmed** auth user, refuses accounts that belong to a company, inserts into `founders`, and audits the grant.
3. Sign in, go to `/account/password`, and **change the password** before anything production-like. Enable MFA for the founder account.
4. Revoke with `select private.revoke_founder('…');`.

Why this is safe: `founders` has no grants for `anon`, `authenticated` **or** `service_role`; there is no insert policy; public signup cannot reach it; `register_company` refuses founders; a company admin cannot make themselves a founder (tested).

## 7. Employee provisioning (design + server module)

`src/lib/admin/provision-employee.ts` (server-only, unit-tested with mocks; **not** exercised against real Supabase Auth):
- Authorization first: `requireCompanyAdmin()` — active admin, in a company with `access = full`. Company id and role come from this database-derived context; any `company_id`/`role` the browser sends is ignored.
- `inviteUserByEmail` (the employee sets their own password; admins never see it). It fails for an email that already has an account, so one company can never capture another company's user.
- Membership is inserted by the service-role client; on failure the new auth user is deleted (no orphan); an `employee.provisioned` audit row is written.
- The service-role key is read only in `src/lib/supabase/admin.ts` (`import "server-only"`). It is never `NEXT_PUBLIC_`.
- No UI yet (M5). Grants (`data_permissions`) are managed by admins directly through RLS-protected inserts/updates.

## 8. Permission matrix (as implemented)

| Capability | Founder | Company admin | Employee |
|---|---|---|---|
| Read all companies / memberships / subscriptions / audit | yes | own company (not subscriptions of others) | own membership only |
| Create company | no (refused) | once, via `register_company` | no |
| Rename company | no | yes (writable state only) | no |
| Suspend / restore, set plan & trial | yes (audited RPCs) | **no** | no |
| Add / change members & roles | no (server-side only) | **no via API** (server-side provisioning) | no |
| Create / rename / delete logical tables | no | yes (writable state) | no |
| Manage `data_permissions` | no | yes (writable state) | no (read own grants) |
| View rows | **no** | all company tables | per-table `can_view` |
| Create / edit / delete rows | no | yes (writable state) | per-table `can_create` / `can_edit` / `can_delete` |
| Import | no | yes (M4) | per-table `can_import` (append only) |
| Export | no | yes | per-table `can_export`, via `authorize_export()` |
| Read company audit log | yes (all) | own company | no |
| Write / alter audit log | no | no | no |

## 9. RLS policies and helper functions

All in `private`, `SECURITY DEFINER`, `search_path = ''`, owner-bypass of RLS (so no recursive policy evaluation), `EXECUTE` revoked from `PUBLIC`/`anon` and granted to `authenticated`/`service_role` only because policies run as the caller:
`is_founder()`, `is_company_member(company)`, `is_company_admin(company)`, `company_can_read(company)`, `company_can_write(company)`, `has_table_permission(table, perm)`, `shares_company_as_admin(profile)`, `accessible_table_ids(perm, write)`; plus owner-only `write_audit`, `grant_founder`, `revoke_founder`, `handle_new_user`.

`data_rows` policies are a single uncorrelated `table_id in (select private.accessible_table_ids(...))`, so access is computed once per statement instead of per row (local benchmark, 200k rows: filtered scan 2,181 ms → 124 ms; employee full count 4,694 ms → 101 ms).

Every M1 table has RLS enabled and no default-allow. Privileges are revoked **per table** (never schema-wide, so unrelated live tables are untouched) and re-granted minimally, including **column-level** grants (e.g. `authenticated` may `UPDATE` only `companies.name`, `profiles.full_name`, and the data columns of `table_metadata`/`data_permissions`/`data_rows`). Policy details are in `supabase/migrations/…_03_rls_and_grants.sql`.

### Known limitation: export enforcement

RLS cannot tell "view" from "export": anyone with `can_view` can still page through rows via the API. `authorize_export(table_id)` is the server-side gate (checks `can_export`/admin, company state, writes an audit row, identical error for unknown vs forbidden tables). The M4 export route **must** call it before streaming. This stops the UI/route from being the only control, but it does not prevent a determined viewer from scraping what they are allowed to see.

## 10. Migrations

| File | Contents |
|---|---|
| `20261013160000_m1_01_tables.sql` | tables, constraints, indexes, `updated_at` + audit-immutability triggers |
| `20261013160100_m1_02_helper_functions.sql` | `private` helper functions (incl. `accessible_table_ids`) and their privileges |
| `20261013160200_m1_03_rls_and_grants.sql` | RLS, policies, table/column grants |
| `20261013160300_m1_04_auth_triggers_and_rpcs.sql` | `auth.users` trigger, profile **backfill**, `register_company`, `get_my_context`, `authorize_export`, founder RPCs |
| `supabase/rollback/20261013160000_m1_rollback.sql` | guarded rollback (outside `migrations/`) |

Each file is wrapped in `begin; … commit;` (a mid-file failure leaves nothing behind — tested). `data_rows.created_by` has no FK on purpose (an unindexed FK to `auth.users` would scan the largest table on user deletion). They are deliberately strict (no `or replace` / `if not exists`): a clash with an existing live object fails the migration instead of overwriting it. Migration 04 inserts one `profiles` row per existing auth user (additive; review the count from inspection query 13).

### Apply gate — all must be true before running anything (your approval required)
1. Project identity verified (dashboard URL ref = `ufaimiecbxjdnapjvjmd`).
2. `docs/m1-live-inspection-queries.sql` results reviewed; name-collision queries empty (or migrations adapted).
3. SQL of all four files reviewed by you; RLS/privilege section (§9) understood.
4. Backup/snapshot taken (Dashboard → Database → Backups) and rollback understood.
5. First apply to a **development/branch** project, not production.
6. Your explicit "apply" instruction.

Suggested workflow once approved: `supabase link --project-ref ufaimiecbxjdnapjvjmd` → `supabase db push --dry-run` → review the plan → `supabase db push`.

### Rollback
`set app.confirm_m1_rollback = 'yes';` then run the rollback script. It drops only M1 objects (plain `DROP`, one transaction, no `CASCADE`), destroys M1 data, and leaves `auth.users` alone. Tested locally: refuses without the setting; removes exactly the M1 objects.

## 11. Tests

| Command | What it runs | Result at last run |
|---|---|---|
| `npm run typecheck` | `tsc --noEmit` | pass |
| `npm run lint` | ESLint | pass |
| `npm test` | Vitest unit tests (route guard, redirect safety, Zod schemas, error mapping, context parsing, employee provisioning with mocks, Supabase environment guard) | **65 passed** |
| `npm run test:db` | Applies the migrations to a throwaway local PostgreSQL 16 cluster behind a Supabase emulation harness and runs the RLS suite, the rollback, and a migration-atomicity scenario, in two modes (no default grants / legacy default grants) | **453 assertions passed** |
| `npm run test:cli-runner` | Applies the migrations with the real Supabase CLI (`db push`) to local PostgreSQL and re-runs the suite on the result | pass (CLI 2.120.0, both modes) |
| `npm run build` | Production build | pass |

DB suite covers: profile creation (and hostile signup metadata ignored); registration atomicity (forced mid-registration failure leaves nothing behind); 30-day trial from the server clock; trial expiry → read-only → paid → lapse; suspension and restore; founder isolation (no access to customer data, no direct writes, unprovisioned/revoked users powerless, `founders` unreachable even by `service_role`); company-admin limits (cannot touch status/plan/trial/memberships/audit); **two companies** with cross-tenant read/write/IDOR attempts in both directions; employees with **edit**, **view-only**, **view+export** and **no** grants, plus a disabled member and an employee of the other company; unauthorized API access as `anon`; structural checks (RLS on every table, no `PUBLIC`/`anon` function execute, empty `search_path` on every definer function, column-level write surface); rollback.

**Not covered / not claimed:** anything against the real Supabase project or Supabase Auth (signup, email confirmation, session refresh, `inviteUserByEmail`, password-change round trip); browser/E2E tests; rate limiting; the emulation harness is plain PostgreSQL, so Supabase-specific behaviour (PostgREST role switching, exact default grants, auth.users columns) is approximated. Re-run the DB suite against a dedicated Supabase **development** project before trusting it for production.

## 12. Environment variables

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | public | anon/publishable key (RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | employee provisioning; bypasses RLS — never prefix with `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_SITE_URL` | public | base URL for email confirmation/invite redirects (must be `https://…` when `VERCEL_ENV=production`) |
| `PRODUCTION_SUPABASE_PROJECT_REF` | server | ref of the **verified** production project; set in every Vercel environment. Production refuses to run without it; non-production refuses a URL that points at it (`src/lib/supabase/config.ts`) |

Set them in `.env.local` (git-ignored) and in Vercel project settings (service-role key as a non-public variable). Never paste keys into chat.

## 13. Remaining manual steps and open decisions

1. Unblock Supabase access (§2) and complete the live review.
2. Supabase Auth settings to confirm/set in the dashboard: email confirmation **on**; Site URL and allowed Redirect URLs (`/auth/callback`); minimum password length ≥ 10; leaked-password protection / CAPTCHA if available on your plan; review Auth rate limits (the app adds no custom rate limiter — in-memory limiters do not work on serverless; use Supabase limits, CAPTCHA, or an edge/KV limiter later).
3. Decide: expired-trial behaviour (§5), one-company-per-user (§3), whether you want a grace period.
4. Approve applying migrations to a dev project, then founder creation (§6).
5. Known gaps for later milestones: `profiles.email` is not re-synced on email change; no generated DB types yet (`supabase gen types` once connected); `table_metadata.row_count` has no maintenance trigger yet (M3); import/replace functions and `import_jobs` (M4); founder console and `manual_payments` (M6).
