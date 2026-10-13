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

## M3, M5-M9

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
