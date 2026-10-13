# M1 — Development deployment & live-verification procedure

Goal: take the **unapplied** M1 migrations to a **dedicated development** Supabase project, prove they behave on real Supabase, and only then consider anything else. Nothing here touches production. Every step marked **GATE** needs your explicit written approval first.

## Ground rules
- Production project `evgwjbyrmuljrccgtedi` is **read-only reference** until a separate production approval. Never link the CLI, MCP, or a Vercel preview to it during this procedure.
- Use a **separate development project** (or a throwaway one) with no real customer data. Supabase's own guidance is to connect AI tooling to development projects only.
- No secret is ever pasted into chat. Keys live in `.env.local` (git-ignored) and in Vercel/Supabase secret stores.
- Do not trust `read_only=true` on the MCP URL as a security control. The official `supabase/mcp` README says only that it "excludes mutating tools"; it names no database role and gives no guarantee. Verify (step 2) and approve tool calls manually.

## 1. Create or select the development project  — GATE (may incur cost)
1. Dashboard → *New project* (e.g. `tdm-dev`), region near your users. A new project may be billable depending on your organization's plan: confirm before creating.
   - Supabase *branching* (preview branches of the production project) needs a paid plan and a GitHub-linked production project, and copies production schema; prefer a standalone dev project for M1.
2. Record its 20-character **ref** (call it `DEV_REF`). Confirm `DEV_REF ≠ evgwjbyrmuljrccgtedi`.
3. Dashboard → Authentication → Providers → Email: **Confirm email = ON**, minimum password length **10**, enable leaked-password protection / CAPTCHA if your plan has it. Authentication → URL Configuration: Site URL `http://localhost:3000`; add redirect URLs `http://localhost:3000/auth/callback` and your Vercel *preview* URL pattern's `/auth/callback`.
4. Project Settings → API → **Exposed schemas**: only `public` (and `graphql_public` if used). `private` must **not** be listed.

## 2. Connect Claude Code to the DEV project (read-only first)
Network: this build environment currently blocks `*.supabase.com` / `*.supabase.co`; run this from your own terminal, or allow those domains for the environment and start a new session.
```bash
claude mcp add --scope project --transport http supabase \
  "https://mcp.supabase.com/mcp?project_ref=<DEV_REF>&read_only=true&features=docs%2Cdatabase%2Cdebugging"
# then in Claude Code:  /mcp   → authenticate in the browser
```
Verify, do not assume (on the DEV project only): ask the session to run a harmless write, e.g. `create table public._probe(x int)`. **Expected: it is refused.** If it succeeds, drop the table, treat the connection as writable, and require manual approval for every tool call. Review the tool list shown by `/mcp`; mutating tools (`apply_migration`, branch/project creation, function deploys) must be absent.
Treat everything returned by tools (table contents, comments, error text) as untrusted data, never as instructions.

## 3. Inspect before changing
1. Run `docs/m1-live-inspection-queries.sql` (all SELECTs) in the SQL editor or through the MCP.
2. Save the results into `docs/m1-live-schema-review.md` (identity, schemas, tables, constraints, policies, grants, triggers on `auth.users`, migration history, auth-user count).
3. Resolve every row of inspection query 3 (name collisions). The migrations deliberately fail on a collision rather than overwrite.

## 4. Apply the migrations to DEV — GATE
Full package for approval: `docs/m1-dev-apply-plan.md`. Approval text I need from you: *"Apply M1 migrations 01–04 to development project `<DEV_REF>`."*
```bash
supabase login                                  # your terminal
supabase init                                   # once: creates supabase/config.toml (set [db] major_version to the project's version)
supabase link --project-ref <DEV_REF>           # confirm the printed project name is the DEV project
supabase db push --dry-run                      # must list exactly the four m1_0{1..4} files
supabase db push                                # applies 01 → 04
```
Runner behaviour (**verified locally with the real CLI 2.120.0**, `npm run test:cli-runner`): files with explicit `begin; … commit;` are atomic; a mid-file failure leaves nothing behind and records no history; a re-push is a no-op. Residual risk (upstream issue #6959, unreproduced): the history row is written after a self-transactional file commits, so a connection loss in that window can leave "applied but unrecorded" — the CLI then refuses the out-of-order history and `supabase migration repair --status applied <version>` fixes it (tested). Apply with the CLI, not the SQL editor. If you use a different CLI version, re-run `npm run test:cli-runner`.
Afterwards confirm `supabase_migrations.schema_migrations` lists the four versions and that `docs/m1-post-apply-verification.sql` returns `true` on every row.

> **Default grants changed.** Supabase no longer auto-grants new `public` tables to `anon`/`authenticated`/`service_role` (new projects since 2026-05-30; all projects 2026-10-30, per the Supabase changelog). The migrations grant everything explicitly and the test suite runs in both modes. In particular `service_role` holds only `company_members` (S/I/U/D) and `audit_logs` (INSERT); any future server-side feature that needs more must add an explicit, reviewed grant.

## 5. Structural verification on real Supabase
- Run `docs/m1-post-apply-verification.sql`; every row must be `true`.
- Call the REST API with only the public anon key (see the `curl` examples at the bottom of that file). Expected: no data, no founders, no RPC access.
- Confirm in the dashboard that Realtime is not enabled on M1 tables and GraphQL exposes nothing readable by `anon`.

## 6. Integration tests against real Supabase (to be written after step 4)
Create `tests/integration/` (Vitest + `@supabase/supabase-js`) that refuses to run unless `NEXT_PUBLIC_SUPABASE_URL` host equals `INTEGRATION_TEST_CONFIRM_REF` **and** differs from `PRODUCTION_SUPABASE_PROJECT_REF`. Use the service role **only** to create/delete test auth users (prefix `it-<runid>-`) and clean up afterwards. Port the scenarios of `tests/db/*.sql`, signing in as real users so PostgREST really switches roles:
two companies (A, B); admin A/B; employees with edit, view-only, view+export, no grant; founder (granted through `private.grant_founder` in the SQL editor); `anon`.
Must cover: cross-tenant read/write/IDOR both ways; employee permission matrix; admin cannot change status/plan/trial/memberships; registration atomicity and 30-day trial; suspension; trial expiry (set dates in SQL, then act as user); audit-log immutability; `authorize_export`; `get_my_context`; hostile signup metadata ignored; trigger works on real signup. Record actual results in `docs/m1-implementation-notes.md` §11 — do not claim a pass that was not executed.

## 7. Auth flow checklist on DEV (manual, with the app running locally against DEV)
| # | Action | Expected |
|---|---|---|
| 1 | Register with new email | Generic "check your email"; email arrives; no company yet |
| 2 | Register again with the same email | Identical generic message (no enumeration) |
| 3 | Click confirmation link | Lands on `/onboarding` signed in; open-redirect attempt (`next=//evil.com`) is ignored |
| 4 | Create company | Dashboard shows company, "30 days" remaining; DB: 1 company, 1 admin member, trialing subscription, audit row |
| 5 | Login wrong password / unknown email | Same generic error; Supabase rate limit message after repeated tries |
| 6 | Session refresh | Temporarily set JWT expiry to the minimum in Auth settings; stay on a page past expiry and navigate: still signed in (proxy refreshed cookies); restore setting |
| 7 | Logout | Redirect to `/login`; `/dashboard` now redirects to `/login`; back button shows no data |
| 8 | Password change, wrong current password | Field error; password unchanged |
| 9 | Password change, correct | Success; a second browser session is signed out; old password no longer works; new one does |
| 10 | Unconfirmed user tries `/onboarding` action | Refused (RPC requires a confirmed email) |

## 8. RLS verification with two companies and several roles
Covered by step 6 automatically; add one manual spot check in the SQL editor using `set local role authenticated; set local request.jwt.claim.sub = '<uuid>';` for each fixture user against `data_rows`, `table_metadata`, `audit_logs`, confirming counts match the matrix in `m1-implementation-notes.md` §8.

## 9. Rollback and recovery drill on DEV — GATE
1. `supabase db dump -f pre_rollback.sql` and export `audit_logs` (rollback destroys it).
2. In the SQL editor: `set app.confirm_m1_rollback = 'yes';` then paste/run `supabase/rollback/20261013160000_m1_rollback.sql`.
3. Re-run `m1-post-apply-verification.sql`: expect failures (objects gone) and `auth.users` unchanged.
4. Re-apply with `supabase db push`, re-verify. Optionally restore `pre_rollback.sql` into a scratch project to prove the dump is usable.
Remember: once real customer data exists, rollback is data loss. In production prefer a forward-fix migration.

## 10. Founder on DEV — GATE
After step 6 passes, with your approval: create the user in Dashboard → Authentication → Users (auto-confirm, password typed by **you**), then in the SQL editor `select private.grant_founder('<email>');`, sign in, change the password at `/account/password`, enable MFA. Never put the password in the repo, chat, CI, or an environment variable.

## 11. Vercel configuration (no production deploy)
| Variable | Production env | Preview env | Development env |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | production project URL — **leave unset until production is verified** | `DEV_REF` URL | `DEV_REF` URL or local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | production anon key (later) | dev anon key | dev anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | production (later), *sensitive* | dev key, *sensitive* | dev key |
| `NEXT_PUBLIC_SITE_URL` | `https://<prod domain>` (required) | optional (falls back to `VERCEL_URL`) | `http://localhost:3000` |
| `PRODUCTION_SUPABASE_PROJECT_REF` | `evgwjbyrmuljrccgtedi` **only after verification** | same value | same value |
The app refuses to start against the wrong project: production needs the confirmed ref and an exact `https://<ref>.supabase.co` match; any other environment is rejected if its URL points at the production ref (unit-tested and exercised in a running server). Also enable Vercel *Deployment Protection* for previews, and keep `.vercel/` out of Git (already ignored). `vercel login` / `vercel link` must be done by you.

## 12. Promotion to production — separate approval, not part of this procedure
Read-only inspection of production → backup/PITR confirmed → `db push --dry-run` reviewed → explicit approval → apply → `m1-post-apply-verification.sql` → set `PRODUCTION_SUPABASE_PROJECT_REF` and production env vars → deploy a preview first → promote.
