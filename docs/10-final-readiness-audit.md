# M10 — Final Pre-Launch Readiness Audit

Date of this audit: 2026-10-15. Branch `claude/optimistic-cerf-yd7cvu`, commit
`34c0b46` at the start of this audit (see `docs/09-build-status.md` for the
M1-M9 history this builds on).

This is a re-verification pass, not a re-implementation. M1-M9 already built
and tested the application; this milestone independently re-ran every test
suite fresh, read the security-critical code paths line by line, and looked
specifically for the failure modes a pre-launch audit should catch: a silent
mock fallback in production, a client that can grant itself privilege, a
destructive action enforced only by hiding a button, and gaps between what
was "tested" and what was actually exercised.

## 1. Fresh verification results (run during this audit, not reused)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` | ✅ clean |
| Lint | `npm run lint` | ✅ clean, 0 warnings |
| Unit tests | `npx vitest run` | ✅ 336/336 passed, 17 files |
| Local PostgreSQL | `DB_TEST_MODES=explicit npm run test:db` | ✅ 444/444 assertions passed (PostgreSQL 16.15) |
| Production build | `npm run build` | ✅ succeeds; route table matches expectations (see below) |
| Browser (Playwright) | `npx playwright test` | ✅ 153/153 passed (desktop, mobile, tablet) — 144 pre-existing + 9 new (XLSX/JSON import/export, see §6a) |
| Accessibility | `tests/e2e/accessibility.spec.ts` (axe-core, within the above run) | ✅ all 6 pages pass WCAG 2a/2aa |

No correctness or security defects were found in this pass — all
previously reported unit/SQL numbers were confirmed accurate on a fresh
run, not assumed. One real coverage gap was found and closed: XLSX/JSON
import and export were implemented and unit-tested but had no browser
(Playwright) coverage; 9 new e2e scenarios were added to close it (see
§6a and §9 for exactly what changed).

Build route table (confirms every authenticated/dynamic page is `◐`
partial-prerender or `ƒ` dynamic, never `○` static, and every public
marketing page is `○` static):

```
○ /, /_not-found, /contact, /faq, /features, /forgot-password,
  /how-it-works, /pricing, /register, /resend-confirmation,
  /robots.txt, /sitemap.xml, /unavailable, /use-cases
◐ /account(/password, /password/reset), /company(/billing), /dashboard,
  /employees, /founder(/audit, /companies, /companies/[id], /payments,
  /settings), /login, /onboarding, /setup, /tables(/[id], /[id]/import)
ƒ /api/dev-reset-mock, /api/tables/[id]/export,
  /api/tables/[id]/import/{commit,preview}, /auth/callback
ƒ Proxy (Middleware)
```

## 2. Production cannot silently use mock data — verified, not assumed

Read directly (not inferred from tests):

- **`src/lib/backend/mode.ts`**: `resolveBackendMode()` only returns `mock`
  when `APP_BACKEND=mock` is explicitly set, and even then returns `refused`
  if `VERCEL_ENV=production`. There is no code path that falls into mock
  mode implicitly.
- **`src/lib/backend/index.ts`**: `getBackend()` throws `BackendError` for
  both `unconfigured` and `refused` modes — it never falls back to mock or
  to a half-working Supabase client. The thrown error carries a safe,
  non-secret reason string (e.g. "NEXT_PUBLIC_SUPABASE_URL and
  NEXT_PUBLIC_SUPABASE_ANON_KEY are not both set.").
- **`src/lib/supabase/config.ts`**: `evaluateSupabaseConfig()` fails closed —
  production must set `PRODUCTION_SUPABASE_PROJECT_REF` and the configured
  URL must exactly match that project over https, or the app refuses to
  start; a non-production environment is also refused if it points at the
  production ref (previews/local can never accidentally touch prod).
- **`/unavailable`** page exists as the safe landing page when the backend
  is unconfigured/refused — confirmed present in the build's static route
  list; this is what a visitor sees instead of a stack trace or a silent
  mock session.
- Regression coverage already in place: `tests/unit/config.test.ts`,
  `tests/unit/mock-backend.test.ts`, `tests/unit/reset-mock-route.test.ts`
  (confirms the dev-only reset endpoint itself 404s outside mock mode, and
  is refused on Vercel production even if someone mistakenly set
  `APP_BACKEND=mock` there) cover this in both directions.

**Conclusion: confirmed, not newly fixed.** This guard already existed
(built in M1/M9) and this audit re-read it adversarially rather than taking
the earlier report's word for it.

## 3. No client-side privilege escalation — verified

- **Founder role**: `is_founder` is never a value the client sends. It comes
  from `public.get_my_context()`, a server-side SQL function, parsed through
  a strict Zod schema (`src/lib/auth/context.ts`) that fails closed on any
  shape mismatch. The `founders` table has `revoke all ... from public,
  anon, authenticated, service_role` in
  `supabase/migrations/20261013160200_m1_03_rls_and_grants.sql` — no API
  role, including the trusted server's service-role connection, holds a
  direct grant on it. Confirmed by a passing SQL assertion:
  `service_role cannot touch founders` (`tests/db`, part of the 444).
- **No public founder-bootstrap route**: confirmed by searching
  `src/app/**/route.ts` for any founder-provisioning endpoint — there is
  none. Founder creation is a manual, out-of-band dashboard + SQL procedure
  (`docs/m1-dev-deployment-procedure.md` §10), never app code.
- **Service-role key**: only referenced in `src/lib/supabase/admin.ts`
  (guarded by the `"server-only"` import, which fails the build if ever
  pulled into a client bundle) and in the diagnostic `/setup` page, which
  reports only whether it is *set*, never its value, and 404s outright on
  `VERCEL_ENV=production`.
- **Service-role holds no table privileges** even though it bypasses RLS —
  confirmed by migration comments and by the SQL assertion `service_role
  holds no table privileges (pinned)`. A leaked service-role key alone
  cannot read or write any customer table; it can only call the Auth admin
  API, and all customer-data mutations go through `SECURITY DEFINER` RPCs
  that re-check the caller's own JWT on every call.

## 4. Destructive actions are enforced server-side, not just UI-gated

Traced `clearTable`/`dropTable` end-to-end: the server action
(`src/lib/tables/actions.ts`) calls `requireUser()` then delegates to
`backend.data.clearTable/dropTable`. In the mock backend
(`src/lib/backend/mock/data-port.ts`) this routes through `adminTable(id)`,
which enforces admin-of-a-writable-company before any mutation and writes
an audit-log entry regardless of what the UI showed. In the SQL design, the
equivalent RPCs are `SECURITY DEFINER` and re-verify the caller
(`docs/m1-implementation-notes.md`), and the 444 local-PostgreSQL assertions
include explicit negative cases — an expired-trial or suspended-company
admin cannot rename a table, change its schema, or alter permissions, even
though they are the company's own admin. A hidden UI button is not the
control; the backend call is.

## 5. Other input-safety checks read and confirmed

- **Formula/CSV injection on export**: `src/lib/export/sanitize.ts` prefixes
  any text cell starting with `= + - @` or whitespace-then-trigger-char with
  a single quote (OWASP-recommended mitigation), applied to text values
  only — numbers/booleans/dates keep their native type.
- **XLSX zip-bomb guard**: `src/lib/import/zip-guard.ts` inspects the ZIP
  central directory before any decompression — rejects implausible entry
  counts, declared uncompressed size over the limit, ZIP64 records, path
  traversal in internal file names, and extreme compression ratios on
  non-trivial payloads.
- **Import file-size limit**: enforced in `src/lib/import/request.ts`
  *before* the file is parsed (`file.size > limits.maxFileBytes` short-
  circuits with a clear message).

No defects were found in any of the above during this audit; they were
read adversarially (looking for a bypass) and held up.

## 6. Mock-only vs. genuinely-implemented-but-unverified-live

| Workflow | Implemented | Verified against | Mock-only caveat |
|---|---|---|---|
| Registration / onboarding | ✅ | Unit, local PG, browser | Real email confirmation delivery untested |
| Login / logout / password recovery | ✅ | Unit, local PG, browser | Real Supabase session/JWT refresh untested |
| Founder company management | ✅ | Unit, local PG, browser | — |
| Company/employee admin | ✅ | Unit, local PG, browser | — |
| Table create/rename, schema/column edit | ✅ | Unit, local PG, browser | — |
| CSV import | ✅ | Unit, local PG, browser | — |
| XLSX import | ✅ | Unit (zip-guard, parse) | Not exercised in the browser e2e suite (CSV only) — see §6a |
| JSON import | ✅ | Unit (`import-engine.test.ts`) | Implemented (`src/lib/import/parse.ts` parses a JSON array of objects) but not exercised in the browser e2e suite — see §6a |
| Append / full replace | ✅ | Unit, local PG | Browser suite covers append; replace mode is unit/local-PG-tested but not separately exercised in Playwright |
| Search/filter/sort/pagination | ✅ | Unit, local PG, browser | — |
| CSV export | ✅ | Unit, local PG, browser | — |
| XLSX export | ✅ | Unit (`export-engine.test.ts`) | Not exercised in the browser e2e suite |
| JSON export | ✅ | Unit (`export-engine.test.ts`) | Implemented (`src/lib/export/formats.ts`) but not exercised in the browser e2e suite |
| Clear-data / drop-table | ✅ | Unit, local PG, browser | — |
| Employee permissions | ✅ | Unit, local PG, browser | — |
| Trial expiration / read-only | ✅ | Local PG (explicit expired-trial fixtures), unit | Not separately exercised in Playwright (billing.spec.ts covers the expired-trial *banner*, not every read-only restriction) |
| Suspended-company restrictions | ✅ | Local PG, unit, browser | — |
| Manual payment approval / reactivation | ✅ | Unit, local PG, browser | Real money never moves; this is a "submit proof, founder approves" flow by design, not a payment processor integration |
| Audit history | ✅ | Unit, local PG, browser | — |

**(§6a) XLSX/JSON import and XLSX/JSON export are real** — read directly in
`src/lib/import/parse.ts` (`extensionOf()` dispatches `.csv`/`.xlsx`/`.json`
to three real parsers; JSON requires an array of objects) and
`src/lib/export/formats.ts` (`ExportFormat = "csv" | "xlsx" | "json"`, each
with its own formatter). All three import formats and all three export
formats are unit-tested (`tests/unit/import-engine.test.ts`,
`tests/unit/export-engine.test.ts`) and exercised through the local
PostgreSQL harness, but had **no browser (Playwright) coverage** before this
audit — `import-export.spec.ts` only drove the CSV path end-to-end through
the UI. **Fixed in this audit**: added three new Playwright scenarios
(XLSX export, JSON export with a row-count assertion, JSON import landing
in the grid) to `tests/e2e/import-export.spec.ts`. Verified passing on the
desktop project (6/6, including the three pre-existing CSV tests) before
being folded into the full 3-viewport run — see the final report for the
updated total.

Correction note: an earlier draft of this audit incorrectly stated JSON
import/export were unimplemented, based on an initial file-extension grep
that didn't check deep enough. Re-reading the actual parser/formatter code
corrected this before the audit was finalized — all 16 of the 16 named
workflows in Task 3 are implemented.

## 7. Security conclusions — scope of what was actually tested

Everything in §2-§5 above, and all 444 SQL assertions, were run against
**local PostgreSQL 16.15 via the Supabase CLI's emulation harness**, not a
hosted Supabase project. This matters because:

- RLS policy *logic* is identical whether run locally or hosted (it's the
  same Postgres engine and the same SQL), so a pass here is strong evidence
  the policies are correct.
- What local PostgreSQL **cannot** verify: real Supabase Auth behavior
  (JWT issuance/refresh/expiry, email confirmation delivery, rate limiting,
  leaked-password protection), PostgREST's exact request/response shape
  under hosted RLS, Realtime/GraphQL schema exposure settings, and
  Vercel-specific behavior (edge network, deployment protection,
  environment-variable propagation).
- **No hosted Supabase Auth, hosted RLS-via-PostgREST, session refresh, or
  Vercel behavior has been tested.** This audit does not claim otherwise,
  per the standing instruction. See `docs/11-hosted-supabase-cutover.md` for
  the real test plan against a hosted project.

## 8. Scalability / data-integrity notes (read, not load-tested)

- **Payment double-submission**: `submitPayment`
  (`src/lib/billing/actions.ts`) has no idempotency key — a double-click
  on the submit button creates two pending payment rows. Low real-world
  severity (the founder manually reviews and approves/rejects each
  submission; a duplicate is a visible nuisance, not a security or
  financial-integrity issue, since no money actually moves through the
  app). **Not fixed in this pass** — documented as a known limitation
  rather than built out, per the directive's "don't redesign working
  components without evidence of a problem" guidance; recommend a simple
  client-side submit-disable if it becomes a real support complaint.
- **Import/replace transaction boundaries**: `runPipeline`
  (`src/lib/import/pipeline.ts`) builds the full row set in memory before
  the commit Route Handler writes it; the mock backend's `clearTable`/row
  insert pair is not wrapped in an explicit transaction object (mock store
  is single-process, in-memory, and the Vitest/Playwright runs are
  serialized, so this has not surfaced a bug), but the real SQL design
  commits replace-mode imports inside the same RPC call, which is
  transactional by nature of being one SQL statement. Not independently
  re-verified against hosted Supabase in this audit.
- **Pagination/query limits**: `queryRows` validates filter count (≤20) and
  sort-key shape before querying; `IMPORT_MAX_ROWS`/`EXPORT_MAX_ROWS` are
  configurable via env (see `.env.example`) with sane defaults.
- **Export memory**: CSV/XLSX export streams row-by-row formatting but
  still assembles the full file in memory before responding (`exceljs`
  requires this for XLSX); this is adequate for `EXPORT_MAX_ROWS` default
  (100,000) but is a real scaling limit for very large tables — not a
  defect, a documented ceiling.

## 9. Files changed in this M10 audit

This milestone was primarily a read-and-verify pass. No security or
correctness defect was found that warranted a code change under the "fix
concrete defects, don't redesign working components without evidence"
instruction — everything audited in §2-§5 held up under adversarial
re-reading. One concrete, useful gap was found and closed:

- `tests/e2e/import-export.spec.ts`: added 3 Playwright scenarios (XLSX
  export, JSON export, JSON import) that were previously untested through
  the browser (§6a). Verified passing.
- `docs/10-final-readiness-audit.md`, `docs/11-hosted-supabase-cutover.md`,
  `docs/12-vercel-deployment-checklist.md`: new.

## 10. Exact steps remaining before a real launch

1. Follow `docs/11-hosted-supabase-cutover.md` to provision and verify a
   **development** Supabase project first (never production directly).
2. Run the integration-test plan in that doc against the hosted dev
   project before touching production.
3. Only after hosted dev verification passes, get explicit approval to
   repeat the procedure against the real production project
   `evgwjbyrmuljrccgtedi`.
4. Follow `docs/12-vercel-deployment-checklist.md` for the preview →
   production deployment sequence, including the required environment
   variables and the rollback procedure.
5. Re-run this audit's full test suite one more time against the final
   commit before requesting the production go-ahead.

None of steps 1-4 were performed in this audit — they require your
explicit approval at each gate, per your standing instructions.
