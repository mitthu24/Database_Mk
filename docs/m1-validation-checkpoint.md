# M1 validation and pre-deployment checkpoint

Scope: audit of the draft M1 migrations, rollback, auth/authorization code and deployment configuration. **Nothing was applied, created or deployed.** The Supabase project `evgwjbyrmuljrccgtedi` is still unreachable from the build environment (egress proxy rejects `supabase.com`, `mcp.supabase.com` and the project host; no Supabase MCP entry exists), so **nothing is verified against live Supabase** and the migrations must not be called production-compatible.

Approved product defaults applied: expired trials read-only (view + export, all writes rejected); one company per user; suspended companies get no data access; no production migration, founder creation or deployment.

## Files audited (actual names)
`docs/m1-implementation-notes.md`, `docs/m1-live-inspection-queries.sql` (there is no `m1-inspection-queries.sql`), `supabase/migrations/20261013160{000,100,200,300}_m1_0{1..4}_*.sql`, `supabase/rollback/20261013160000_m1_rollback.sql`, `src/lib/auth/{actions,dal,context,validation,route-guard}.ts`, `src/lib/admin/provision-employee.ts`, `src/lib/supabase/*`, `src/proxy.ts`, `tests/db/*`, `tests/unit/*`, `scripts/test-db.sh`.

## Findings fixed in this pass (draft migrations and code; none applied anywhere)
| # | Finding | Evidence | Fix |
|---|---|---|---|
| F1 | Migration files were not transactional: a name collision mid-file would leave earlier tables behind | New scenario in `scripts/test-db.sh` forces a collision on the 5th table | Each migration is wrapped in `begin; … commit;`. The scenario now proves nothing is left behind and the pre-existing table is untouched |
| F2 | `data_rows.created_by` had a foreign key to `auth.users` with no index: deleting a user would scan the whole rows table | FK-index audit in `tests/db/80_robustness.sql` | FK removed (attribution-only column); the test now fails if `data_rows` ever gains an unindexed FK |
| F3 | RLS on `data_rows` called permission functions once per row | Benchmark, 200k rows, local PG16: filtered scan **2,181 ms**, employee full count **4,694 ms** | Policies use one uncorrelated `table_id in (select private.accessible_table_ids(...))` (hashed SubPlan): **124 ms** and **101 ms**; first-page queries stay ~1 ms. All behavioural assertions unchanged. Indicative only (local PostgreSQL) — re-measure on Supabase |
| F4 | Nothing stopped a Vercel preview from using the production DB, or production from running against an unverified project | New `src/lib/supabase/config.ts`, 16 unit tests, and three simulated environments run against a live `next start` | Fail-closed guard: production needs `PRODUCTION_SUPABASE_PROJECT_REF` and an exact `https://<ref>.supabase.co` match; any other environment is rejected if it points at that ref; production also needs an explicit `https` `NEXT_PUBLIC_SITE_URL` (no localhost fallback in email links) |
| F5 | `/setup` (M0) was prerendered at build time (stale snapshot) and showed configuration state in production | Route table showed `○` | Now dynamic, and returns no diagnostic content in production (verified: nothing in the payload) |
| F7 | Server-side provisioning relied on Supabase default grants for `service_role`; on a new project (no default grants) it fails with `permission denied for table company_members`, and on a legacy project `service_role` could read all customer rows | Suite run in a new "no default grants" mode failed on the new service_role test; legacy mode failed the least-privilege test | `service_role` is revoked everywhere and granted exactly `company_members` S/I/U/D + `audit_logs` INSERT (pinned by test and by `m1-post-apply-verification.sql`); the suite now runs in both modes |
| F6 | Write-path coverage under trial expiry/suspension was by example only | — | Pinned inventory of everything `authenticated` may write (fails if a new write path appears), policy-text assertion that every write policy on company data requires the entitlement check, and systematic expired/suspended attempts for an admin and for an employee holding create/edit/delete grants |

## Audit checklist (task 2)
| Check | Result |
|---|---|
| Dependency order | Tables → helper functions → RLS/grants → triggers/RPCs; applies cleanly in order (local) |
| Re-execution | Intentionally **not idempotent** (no `or replace`/`if not exists` except `schema private`). A re-run fails at its first statement and, being transactional, changes nothing (proven for a mid-file collision) |
| FKs / constraints / indexes | Composite FKs make cross-tenant rows structurally impossible (tested with RLS bypassed); check constraints on names, status, plan, dates, JSON shape/size; every FK indexed except small-table `created_by` columns |
| RLS enablement and grants | RLS on all 9 tables; privileges revoked per table then re-granted; column-level write grants; `anon` has nothing; write surface pinned by test |
| SECURITY DEFINER hygiene | Every definer function has `search_path=""`; all references schema-qualified; `EXECUTE` revoked from `PUBLIC`/`anon`; operator functions executable by nobody but the owner (all asserted structurally) |
| Company/founder isolation | Two-company tests both directions; founder cannot read customer data or write directly; `founders` unreachable even by `service_role`; no path from signup or admin to founder |
| Suspension | Reads and writes blocked at RLS for all roles in the company; company/subscription rows stay visible; restore tested |
| Trial expiry on every write path | Policies for `companies`, `table_metadata`, `data_permissions`, `data_rows` all require `company_can_write` (asserted from `pg_policies`); only own-profile name remains editable (not company data); `authorize_export` and reads stay allowed by design |
| Registration atomicity | Forced failure of the last insert leaves no company, membership or audit row; a second registration is refused (sequential case tested; a concurrent race is stopped by the `unique(user_id)` constraint by construction, not load-tested) |
| Audit-log immutability | No client write privilege, `service_role` insert-only, and triggers block UPDATE/DELETE/TRUNCATE even for the owner |
| Export | `authorize_export` gate enforced and audited in the database; **the future export route must call it**; RLS cannot distinguish view from export (documented limitation) |
| Rollback completeness | Removes exactly the M1 objects (dropping `private` without CASCADE fails if anything remains); refuses without confirmation; leaves `auth.users` untouched. **Data-loss risk:** destroys all M1 data including audit logs and the profile backfill — export first; never use it after real customer data exists |
| Signup trigger | Fires when `auth.users` is written by an emulated `supabase_auth_admin` role that has no access to schema `private` |

## Open items (cannot be closed locally)
1. `private` must not be an exposed API schema, and the real PostgREST role switch, default grants and `auth.users` shape are only emulated. Close with `m1-post-apply-verification.sql` + REST probes on a dev project.
2. ~~How the Supabase CLI wraps migration files~~ — **verified locally** with the real CLI 2.120.0 (`npm run test:cli-runner`): explicit `begin/commit` is compatible and atomic. Remaining: re-run on dev with your CLI version; the unreproduced upstream history-gap window (#6959) is covered by `migration repair`.
3. A failure inside the `auth.users` trigger would break **all** signups — test on dev; monitor after release.
4. Access resumption currently depends only on the founder RPC `founder_set_subscription`. Your rule ("only after a valid subscription **and** any required manual payment is approved") needs `manual_payments` (M6): its approval function must become the **only** way to move a subscription to `active`, and direct founder activation should then be removed or audited as an override.
5. Any future service-role code path bypasses RLS and must re-check entitlement itself (as `provisionEmployee` does). M4 import/replace functions must check `company_can_write` plus the `import` permission (append) or admin (replace-all).
6. The founder can read all profiles (name/email) for support; intentional, but confirm.
7. No custom rate limiting (in-memory limiters are ineffective on serverless): rely on Supabase Auth limits and CAPTCHA; re-check before launch.
8. The guard rejects custom Supabase domains (only `<ref>.supabase.co`); adjust it if you adopt one. The browser client (`src/lib/supabase/client.ts`, unused so far) reads build-time-inlined public variables and bypasses the guard; use it only in builds whose environment already passed the server guard.
9. MCP `read_only=true` is not a proven guarantee (see the deployment procedure).
10. The 200k-row benchmark is local and synthetic; GIN-assisted `jsonb` search and large-import behaviour need testing on Supabase hardware in M3/M4.

## Results of local checks (final code)
| Check | Result |
|---|---|
| `npm run typecheck` (`next typegen && tsc --noEmit`, from a clean checkout) | pass |
| `npm run lint` | pass |
| `npm test` | **65 passed** (route guard, redirect safety, Zod schemas, error mapping, context parsing, employee provisioning with mocks, environment guard) |
| `npm run test:db` | **453 assertions passed** across two modes (no default grants / legacy default grants) on local PostgreSQL 16.15 behind a Supabase emulation harness (includes rollback and the migration-atomicity scenario) |
| `npm run test:cli-runner` | real Supabase CLI 2.120.0 `db push` against local PostgreSQL: apply, history, no-op re-push, mid-file failure, history-gap repair, 220 RLS assertions + post-apply verification on the CLI-applied schema — pass in both modes |
| `docs/m1-post-apply-verification.sql` run against the migrated local schema | 13/13 checks `true` (the "private not exposed" row is only meaningful on Supabase) |
| `npm run build` | pass |
| Secret sweeps | temporary founder password: 0 occurrences in tree and in all Git history; no key-like strings; only `.env.example` tracked; no `SERVICE_ROLE`/admin-client/invite/`grant_founder` strings in the built browser JS |

## Classification of every item
**Verified locally** (no Supabase involved)
- Migration order and clean application; transactional failure behaviour; non-idempotent-by-design behaviour
- RLS, grants, column privileges, helper functions, definer hygiene, execute privileges
- Company/founder/employee isolation; two-company IDOR tests; disabled-member handling
- Suspension, expired-trial read-only, paid/lapsed transitions; every write path (pinned inventory)
- Registration atomicity and 30-day trial from the server clock; hostile signup metadata ignored
- Audit-log immutability; `authorize_export` gate; `get_my_context` contract
- Rollback refusal, completeness and `auth.users` preservation
- RLS performance fix (benchmark before/after)
- Route guard, open-redirect protection, password/registration validation, error mapping
- Employee provisioning authorization and rollback-on-failure (mocked clients)
- Service-role credentials server-only (`server-only` import; absent from client bundle)
- No secrets or temporary founder password in source or Git history; `.env.example` placeholders only
- Environment guard for Vercel (unit tests + three simulated environments in a running server); production `/setup` hidden
- Typecheck, lint, unit tests, DB tests, production build

**Verified against live Supabase**
- *None.* No connection to any Supabase project was possible.

**Blocked by authentication / network**
- Supabase MCP connection and project identity check for `evgwjbyrmuljrccgtedi` (egress proxy rejects Supabase hosts; no MCP entry; browser OAuth is yours to do)
- Live schema inspection and `docs/m1-live-schema-review.md`
- Real Supabase Auth flows: signup, email confirmation, login, session refresh, logout, password change, invites
- Real-database RLS tests, signup-trigger test, exposed-schema check, REST/GraphQL probes
- Vercel: not authenticated (`vercel whoami`: logged out), no project link, no token; no Vercel configuration could be verified

**Awaiting your approval**
- Creating/selecting the dedicated Supabase **development** project (may be billable)
- Applying migrations 01–04 to that development project
- Writing and running `tests/integration/` against it
- Creating the founder account (dev, then later production) and changing its password
- Rollback drill on dev
- Any production migration, production founder, Vercel project link or deployment (not authorized by this checkpoint)
- Product decisions still open: whether to relax one-company-per-user later; founder read access to profiles; custom-domain support for the guard
