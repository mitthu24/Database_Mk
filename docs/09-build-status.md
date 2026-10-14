# Build status

Living document, updated after each milestone. Verification is tracked in six
**separate** columns — a pass in one is never evidence for another:

1. **Unit** — `npm test` (Vitest, mocks/logic only).
2. **Local PostgreSQL** — `npm run test:db` (real Postgres 16, both grant modes) and
   `npm run test:cli-runner` (real Supabase CLI applying the migrations).
3. **Browser** — Playwright against the running app (not yet run this milestone).
4. **Hosted Supabase** — a real Supabase project. **Not configured. Not attempted.**
5. **Vercel preview** — a deployed preview build. **Not attempted.**
6. **Production** — **not attempted, and will not be until explicitly approved.**

Mock-backend tests (unit, column 1) prove the application logic and UI behave
correctly against rules that mirror the SQL. They are never presented as
evidence for columns 4-6.

## M1 — Database, auth & security foundation

Migrations `20261013160000`-`20261013160300` (profiles, founders, companies,
members, subscriptions, tables, permissions, rows, audit; RLS; auth triggers;
core RPCs). See `docs/m1-implementation-notes.md`.

| Check | Unit | Local PG | Browser | Hosted Supabase | Preview | Prod |
|---|---|---|---|---|---|---|
| Schema + RLS + rollback | - | ✅ | - | ❌ not attempted | ❌ | ❌ |

## M2 — Data/import/export engine, backend port, mock backend, auth refactor

Migrations `20261013170000`-`20261013170200` (logical tables, rows, row
validation, atomic import, payments, members, founder views — 7 migrations
total). TypeScript: `src/lib/data/*`, `src/lib/import/*`, `src/lib/export/*`,
`src/lib/backend/*` (the `Backend`/`AuthPort`/`AuthAdminPort`/`DataPort`
interfaces, a Zod-validated Supabase adapter, and an explicit dev/test mock
adapter selected only by `APP_BACKEND=mock`, refused on `VERCEL_ENV=production`).
`src/lib/auth/actions.ts`, `dal.ts`, `src/lib/admin/provision-employee.ts`, and
`src/app/auth/callback/route.ts` now go through the backend port instead of
talking to the Supabase client directly, so the same code path runs against
either backend. `provisionEmployee` invites via `authAdmin.inviteUser` and
attaches the membership via `data.addMember`, which re-verifies the caller's
admin/entitlement status itself; on failure the invited auth user is deleted.

Forgot/reset-password, resend-confirmation, account settings (display name)
and company profile pages are built, wired through the backend port, and
covered by unit tests. The remaining UI kit (dialog, alert-dialog,
dropdown-menu, tabs, select, checkbox, textarea, skeleton, table) and a
sonner toaster are in; `error.tsx` (Next 16 `retry` prop), `not-found.tsx`,
`loading.tsx`, and `/unavailable` are in place. Still open: a more complete
mock-conformance suite ported from `tests/db/`, and employee-management UI
(M6) still uses the plain `provisionEmployee` action with no dedicated page.

| Check | Unit | Local PG | Browser | Hosted Supabase | Preview | Prod |
|---|---|---|---|---|---|---|
| SQL data engine (05-07) | - | ✅ 444 assertions (explicit mode); CLI runner ✅ | - | ❌ | ❌ | ❌ |
| Row/column validation, import/export engines | ✅ | - | - | - | - | - |
| Mock backend (29 conformance scenarios) | ✅ | n/a (proves logic, not Postgres/RLS) | - | - | - | - |
| Backend port + Supabase adapter (Zod-validated) | ✅ (contract fixtures) | - | ❌ not exercised against a live project | ❌ | ❌ | ❌ |
| Auth actions / DAL / provision-employee on the port | ✅ (unit, mocked) | - | ❌ | ❌ | ❌ | ❌ |
| Forgot/reset password, resend confirmation, account & company profile | ✅ (unit, mocked) | - | ❌ not exercised in a browser | ❌ | ❌ | ❌ |
| `npm run typecheck` / `npm run lint` / `npm run build` | ✅ all pass | - | - | - | - | - |

## M4 — Company dashboard & table explorer

Table library (`/tables`, search via card grid, create-table dialog with a
dynamic column builder) and the table detail grid (`/tables/[id]`): sticky
header, mouse-drag column resizing, server-side pagination/sort/search,
row add/edit dialog (typed inputs per column type), bulk row selection with a
confirmed delete, a per-row context menu, rename/schema-editor dialogs, and
`AlertDialog`-confirmed clear-data/drop-table actions. All of it goes through
`src/lib/tables/actions.ts`, thin server-action wrappers over `DataPort` that
re-throw `BackendError` as UI-safe messages; authorization itself is the
backend's (RLS / mock), never the UI's.

Browser-verified against the mock backend (Chromium, manual Playwright smoke
script, not yet a committed test suite): signed in as the seeded personas,
created a table, added a row, renamed it, edited its schema, cleared its
data, paginated and sorted the seeded 250-row Orders table, and confirmed
that a view+export-only employee (Vic) sees only their granted table with no
add-row control, matching the access flags the backend returned.

| Check | Unit | Local PG | Browser | Hosted Supabase | Preview | Prod |
|---|---|---|---|---|---|---|
| Table/row actions (validation, error mapping) | ✅ | n/a (SQL side covered in M2's 444 assertions) | - | - | - | - |
| Table library, grid, dialogs, permission-aware UI | - | - | ✅ manual smoke run against the mock backend | ❌ | ❌ | ❌ |

Not yet in a committed Playwright suite (that is M9's job): the manual smoke
run above is real browser evidence, not a regression test.

## M5 — Import / export

Route Handlers (not Server Actions, so uploads are not bound by the 1 MB
Server Action body cap): `GET /api/tables/[id]/export` streams CSV/XLSX/JSON
page-by-page via `queryRows` after `authorizeExport()` succeeds (the
server-side authorization gate, checked before any row is read; respects the
grid's current search/sort so a filtered view exports what's on screen).
`POST /api/tables/[id]/import/preview` and `.../import/commit` share
`src/lib/import/request.ts`, which parses the multipart upload and re-runs
`parseUpload` + `runPipeline` from scratch on the server — commit never
trusts a client-echoed row list, it re-validates the same file again.
`/tables/[id]/import`: file picker, live column-mapping editor, onError
(reject/skip) and skip-duplicates toggles, replace-mode (manage-only), issue
list, a 10-row sample, and an import-history table from `listImportJobs`.
Export/Import buttons on the grid are gated by `access.export` /
`access.import || access.manage`, matching the backend's own flags.

Browser-verified against the mock backend (manual Playwright smoke script,
same caveat as M4 — not yet a committed regression test): exported Orders
(250 seeded rows) as CSV, JSON and XLSX and checked row counts and headers;
imported a 2-row CSV into Vendors (append), saw it land in the grid and in
import history; then re-ran the wizard with a row missing a required field
and confirmed the UI blocks the import and shows why, with no "Import rows"
button rendered.

| Check | Unit | Local PG | Browser | Hosted Supabase | Preview | Prod |
|---|---|---|---|---|---|---|
| Export engine (CSV/XLSX/JSON, formula-injection sanitizer) | ✅ (pre-existing) | n/a | ✅ manual smoke (3 formats) | ❌ | ❌ | ❌ |
| Import engine (parse/coerce/pipeline, zip guard) | ✅ (pre-existing) | n/a | ✅ manual smoke (preview+commit+blocked case) | ❌ | ❌ | ❌ |
| `parseImportRequest` (multipart parsing + re-validation) | ✅ | - | ✅ (covered by the smoke run above) | - | - | - |
| Route Handlers (auth gate, streaming, error mapping) | - | - | ✅ manual smoke | ❌ | ❌ | ❌ |

## M6 — Employees and permissions

`/employees` (admin-only): member list with role/status controls
(`MemberRoleControl`, `MemberStatusControl` — status changes go through a
confirm `AlertDialog`, both refuse to act on the signed-in admin's own row),
employee code badge, an `AddEmployeeDialog` that invites via `authAdmin` +
`add_company_member` (the existing `provisionEmployee`, unchanged), and a
per-employee `PermissionsDialog`: a table-by-table grid of
view/create/edit/delete/import/export checkboxes (any operation implies
view; unchecking view clears the rest), saved per table via
`setTablePermission`. All of it goes through `src/lib/employees/actions.ts`,
thin wrappers over `DataPort` — the server re-verifies the caller is the
company's admin and a company admin still cannot touch another company's
members (enforced by the backend, not this UI).

Browser-verified against the mock backend (manual Playwright smoke script):
signed in as Acme's admin, opened the employee list (4 members), opened the
permissions grid for an employee with no grants, checked "view" on one
table, saved, then signed in as that employee and confirmed the table was
now visible in their `/tables` list — the UI change took effect through the
same backend rules the SQL tests cover.

| Check | Unit | Local PG | Browser | Hosted Supabase | Preview | Prod |
|---|---|---|---|---|---|---|
| Employee actions (status/role/code/permissions, error mapping) | ✅ | n/a (SQL side covered in M2's suite) | ✅ manual smoke | ❌ | ❌ | ❌ |
| Employee directory & permission-grid UI | - | - | ✅ manual smoke (grant takes effect for the employee) | ❌ | ❌ | ❌ |

## M7 — Subscription, trial and payments (company side)

`/company/billing`: a status banner (trialing with days-left warning at <=7
days, read-only on an expired trial or inactive subscription, suspended with
no data access), the platform's payment instructions and support email
(`getPlatformSettings()`), a submit-payment form (admin-only, hidden when
the company is suspended — matching the backend rule that a suspended
company cannot submit payments while an expired one can), and payment
history (admin-only — `listPayments()` is itself founder/admin-scoped by the
backend, so an employee is never asked to call it). `submitPayment` calls
`revalidatePath` so the new payment appears in history immediately, no
reload needed. Founder-side review/approval (`founder_review_payment`) is
M3's job, not built yet.

Browser-verified against the mock backend: Alice (Acme, trialing) saw the
submit form and a newly submitted payment appear in her own history without
a reload; Bob (Birch, expired trial) saw the read-only banner and could
still submit a payment; Carol (Cedar, suspended) saw the suspended banner
with no submit form at all.

| Check | Unit | Local PG | Browser | Hosted Supabase | Preview | Prod |
|---|---|---|---|---|---|---|
| `submitPayment` validation + error mapping | ✅ | n/a (SQL side covered in M2's suite) | ✅ manual smoke | ❌ | ❌ | ❌ |
| Billing page states (trial/read-only/suspended) & history | - | - | ✅ manual smoke (3 personas) | ❌ | ❌ | ❌ |

## M3 — Founder Super Admin

`/founder`: overview dashboard (company/member/table/row totals, trial/paid/
expired/suspended breakdown, trials ending ≤7 days, a dependency-free SVG bar
chart for signups by month, and approved-payments-last-30-days). `/founder/
companies`: searchable, state-filtered, paginated directory; detail page
with profile, a `founderSetSubscription` override (trialing/past_due/
canceled — never `active`, which only an approved payment can set), a
confirmed suspend/re-activate control, members, and that company's payments.
`/founder/payments`: platform-wide pending/approved/rejected tabs with
approve/reject (reject requires a reason). `/founder/audit`: platform-wide,
paginated. `/founder/settings`: payment instructions / support email / plan
price text, the same values the company billing page reads. Company
provisioning (`CreateCompanyDialog`) invites the admin via `authAdmin` and
calls `founderCreateCompany`, deleting the invited user if company creation
fails. All of it goes through `src/lib/founder/actions.ts` over `DataPort`;
the backend is the actual authority (a company admin cannot reach any of
this; `founderSetSubscription` itself refuses `"active"`).

While building this milestone, every `(app)` page that reads per-request
data (not just the new founder pages) was found to be missing the Next 16
Cache Components dynamic marker — `next build` had been silently marking
them `○` (static) instead of `◐` (partial prerender), and the mock backend's
use of `new Date()` for entitlement checks surfaced it as a dev-time
"unstable value" warning. Fixed by adding `await connection()` to the top of
every `(app)` page's content component (16 files); confirmed with `next
build` (all now render `◐`) and by watching the dev console show zero such
warnings across a full click-through.

Browser-verified against the mock backend (manual Playwright smoke script):
filtered the company directory to "suspended" (1 match), opened a company's
detail page, approved Birch's pending payment and confirmed its access
flipped to `full` immediately (reading the real approval-math code path,
not a stub), re-activated a suspended company, confirmed new audit entries
appeared, saved a platform setting, and provisioned a brand-new company end
to end (invite → create → redirect to its detail page with the right data).

| Check | Unit | Local PG | Browser | Hosted Supabase | Preview | Prod |
|---|---|---|---|---|---|---|
| Founder actions (status/subscription/payment review/create-company/settings) | ✅ | n/a (SQL side covered in M2's suite) | ✅ manual smoke | ❌ | ❌ | ❌ |
| Founder console pages (dashboard, companies, payments, audit, settings) | - | - | ✅ manual smoke (full click-through) | ❌ | ❌ | ❌ |
| `await connection()` dynamic-rendering fix across all `(app)` pages | - | - | ✅ (`next build` route table + zero console warnings) | - | - | - |

## M8-M9

Not started. See `docs/08-milestones.md` for scope.

## Known limitations / explicitly not done

- Nothing has been verified against a hosted Supabase project, a browser, a
  Vercel preview, or production. `APP_BACKEND=mock` has never been exercised
  outside this repository's own test run.
- No founder account exists anywhere outside the seeded mock store (whose
  "founder" is a fictional persona with a dummy password, see
  `src/lib/backend/mock/store.ts`).
- Row-level security has not been exercised through PostgREST/the JS client
  against a live database in this milestone (only via the local-PostgreSQL
  harness and the real Supabase CLI against a local throwaway cluster).
