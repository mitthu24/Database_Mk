# M10 — Hosted Supabase cutover plan

This is the consolidated, launch-facing checklist for moving from the local
mock/PostgreSQL-tested application to a real hosted Supabase project. It
summarizes and sequences the detailed procedures already written in
`docs/m1-dev-deployment-procedure.md`, `docs/m1-dev-apply-plan.md`, and
`docs/m1-implementation-notes.md` — read those for the full detail behind
each step below; this document is the checklist, not a replacement.

**Nothing in this document has been executed.** No Supabase project has
been created, no migration has been applied to a hosted project, and no
founder account exists outside the in-memory mock store. Every gate below
requires your explicit written approval before the step runs, per your
standing instructions.

## Required environment variables

From `.env.example` (see that file for the authoritative list and inline
comments — values below are name + purpose only, never actual secrets):

| Variable | Public/Server | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | The Supabase project's REST/Auth URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Anon key used by the browser client (RLS still applies) |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-only** | Used only by `src/lib/supabase/admin.ts` (guarded by `"server-only"`); bypasses RLS but holds no table privileges per the migrations — used solely for the Auth admin API |
| `NEXT_PUBLIC_SITE_URL` | Public | Base URL for auth redirect links; **required `https://` in production**, refuses to start otherwise |
| `PRODUCTION_SUPABASE_PROJECT_REF` | Server | The verified production project's 20-char ref; must be set in **every** Vercel environment (prod, preview, dev) — this is the fail-closed guard that stops a preview from touching production |
| `APP_BACKEND` | Server | Leave **unset** for any real deployment. `mock` is dev/test-only and is automatically refused when `VERCEL_ENV=production` |
| `IMPORT_MAX_FILE_KB`, `IMPORT_MAX_ROWS`, `EXPORT_MAX_ROWS` | Server | Optional; sane defaults apply |

No actual values are included here or anywhere in this document.

## Migration sequence

Seven migrations exist, all currently marked `STATUS: DRAFT — NOT APPLIED`
in their own header comments:

```
20261013160000_m1_01_tables.sql
20261013160100_m1_02_helper_functions.sql
20261013160200_m1_03_rls_and_grants.sql
20261013160300_m1_04_auth_triggers_and_rpcs.sql
20261013170000_m2_05_data_engine.sql
20261013170100_m2_06_payments_settings.sql
20261013170200_m2_07_members_and_founder_views.sql
```

They apply in this numeric order via `supabase db push` (never hand-run in
the SQL editor — see the CLI-atomicity note below). Two rollback scripts
exist (`supabase/rollback/20261013160000_m1_rollback.sql`,
`supabase/rollback/20261013170000_m2_rollback.sql`) and both refuse to run
without an explicit `set app.confirm_*_rollback = 'yes';` first — confirmed
by a passing SQL assertion (`rollback refuses to run without explicit
confirmation`).

**CLI atomicity**: verified locally with the real Supabase CLI
(`npm run test:cli-runner`, CLI 2.120.0) that a file written with explicit
`begin; … commit;` is atomic — a mid-file failure leaves nothing behind.
Known residual risk from upstream Supabase CLI issue #6959 (unreproduced
here): a connection loss in the narrow window between a self-transactional
file's commit and its history-row write can leave the migration "applied
but unrecorded." `supabase migration repair --status applied <version>`
fixes this if it happens. Re-run `npm run test:cli-runner` if a different
CLI version is used.

## Sequence of gates

1. **GATE — Create/select a development Supabase project.** Never the
   production project `evgwjbyrmuljrccgtedi` for this step. Record its ref
   as `DEV_REF` and confirm `DEV_REF ≠ evgwjbyrmuljrccgtedi`. Full detail:
   `docs/m1-dev-deployment-procedure.md` §1.
2. **Connect read-only first.** Verify any MCP/CLI connection is actually
   read-only by attempting a harmless write and confirming it's refused —
   do not trust a `read_only=true` URL parameter as a guarantee (Supabase's
   own docs only promise it excludes mutating *tools*, not that it names a
   restricted database role).
3. **Inspect the live project before changing anything** — run
   `docs/m1-live-inspection-queries.sql`, resolve every naming collision the
   migrations would hit (they fail on collision rather than silently
   overwrite).
4. **GATE — Apply the seven migrations to the dev project**, via
   `supabase db push` (dry-run first, confirm it lists exactly the expected
   files). Approval text required: *"Apply migrations 01-07 to development
   project `<DEV_REF>`."*
5. **Structural verification**: run `docs/m1-post-apply-verification.sql`
   (every row must read `true`); confirm the anon key alone cannot read
   founders/companies/other customers' data via a direct REST call.
6. **Write and run the hosted integration test plan** (below) against the
   dev project — this is the step that actually exercises real Supabase
   Auth, real RLS-via-PostgREST, and real session handling, none of which
   the local-PostgreSQL harness can prove.
7. **GATE — Rollback/recovery drill on dev.** Dump the dev project, run the
   rollback script with explicit confirmation, re-verify objects are gone
   and `auth.users` is untouched, then re-apply and re-verify. This proves
   the rollback path works before anyone depends on it for real.
8. **GATE — Create the founder account on dev.** Manual, out-of-band:
   create the user via the Supabase dashboard (you type the password,
   never the assistant), then in the SQL editor
   `select private.grant_founder('<email>');`. No founder-provisioning
   route exists in the app, by design — confirmed by this audit
   (`docs/10-final-readiness-audit.md` §3).
9. **GATE — Repeat against production**, only after every step above has
   passed on dev and you give separate, explicit approval naming the
   production project. This includes a fresh backup/PITR confirmation and
   a reviewed `db push --dry-run` output before the real apply.

## Real authentication test plan (hosted dev project)

This is what "verified against hosted Supabase" means for this app — run
manually against the app pointed at `DEV_REF`, per
`docs/m1-dev-deployment-procedure.md` §7:

| # | Action | Expected |
|---|---|---|
| 1 | Register with a new email | Generic "check your email" message; confirmation email actually arrives; no company created yet |
| 2 | Register again with the same email | Identical generic message — no enumeration of which emails exist |
| 3 | Click the confirmation link | Lands signed-in on `/onboarding`; an open-redirect attempt (`next=//evil.com`) is ignored |
| 4 | Create a company | Dashboard shows the company and a 30-day trial; DB has exactly one company, one admin member, one trialing subscription, one audit row |
| 5 | Wrong password / unknown email | Same generic error either way; Supabase's own rate-limit kicks in after repeated attempts |
| 6 | Session refresh | Temporarily shorten JWT expiry in Auth settings; stay on a page past expiry and navigate — still signed in (the proxy middleware refreshed the session cookie); restore the setting afterward |
| 7 | Logout | Redirects to `/login`; `/dashboard` now redirects to `/login`; browser back button shows no cached data |
| 8 | Password change, wrong current password | Field-level error; password unchanged |
| 9 | Password change, correct current password | Succeeds; a second open session is signed out; old password stops working, new one works |
| 10 | Unconfirmed user attempts an onboarding action | Refused — the RPC requires a confirmed email |

Plus the full two-tenant RLS cross-check (company A cannot read/write
company B's `data_rows`/`table_metadata`/`audit_logs`; an employee's
permission matrix holds; an admin cannot alter their own company's status,
plan, trial, or membership) — the local-PostgreSQL suite already covers
this logically, but it must be re-run against hosted PostgREST with real
signed-in users (not `set local role`) to confirm PostgREST enforces the
same policies identically.

## Rollback and recovery instructions

- **Pre-production-apply**: `supabase db dump` the target project and
  separately export `audit_logs` (the rollback script deletes it) before
  running any rollback.
- **Rollback trigger**: run the matching
  `supabase/rollback/<timestamp>_*.sql` file with its required
  `set app.confirm_*_rollback = 'yes';` preamble. Confirmed
  (local PostgreSQL) to fully remove its own objects, restore prior
  function/trigger behavior, and leave `auth.users` untouched.
- **Re-apply**: `supabase db push` again; re-run
  `docs/m1-post-apply-verification.sql`.
- **Once real customer data exists**, prefer a forward-fix migration over
  a rollback — rollback is data loss for anything created after the
  migration being rolled back.

## Known limitations going into this cutover

- No hosted Supabase project has ever been connected to this app. Every
  number in `docs/10-final-readiness-audit.md` comes from local PostgreSQL
  16.15, the in-memory mock backend, and a locally-served production build
  — never a real Supabase Auth flow, real PostgREST, or real network
  latency/error conditions.
- The residual Supabase CLI history-recording race (issue #6959) is
  unreproduced but not ruled out; the repair command is documented above
  as the fix if it's ever hit.
- Realtime and GraphQL exposure on the new tables have not been checked
  against this app's migrations specifically — step 1 above includes
  confirming only `public` is an exposed schema and Realtime is off for
  these tables.
