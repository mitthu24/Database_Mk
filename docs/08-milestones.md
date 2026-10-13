# Milestone Plan & Acceptance Tests

## M0 — Foundation (this setup)
- Next.js + TypeScript + Tailwind + shadcn-style UI layer scaffolded.
- Supabase client (browser/server/middleware) wired with placeholder env vars.
- `/setup` verification page.
- Architecture, schema, RLS, role matrix, workflow, and backup docs written.
- **Acceptance**: `npm run lint` and `npm run build` pass; `/setup` renders
  and correctly reports missing env vars when unset.

## M1 — Supabase connected + core schema
- Supabase MCP/CLI connected; live project inspected.
- Migrations for `profiles`, `companies`, `company_members`, `founders`
  applied to a dev project, with RLS policies from `04-tenant-isolation.md`.
- Founder bootstrap procedure documented and executed out-of-band (dashboard
  or a one-off server script), not hardcoded anywhere.
- **Acceptance**: a founder user and one test company+admin exist in dev; a
  second company's admin cannot query the first company's `company_members`.

## M2 — Auth & shell
- Email/password sign-up (company self-registration → 30-day trial set
  server-side) and sign-in.
- Role-aware app shell: founder / admin / employee navigation.
- **Acceptance**: a newly registered company has `trial_ends_at` set to
  `created_at + 30 days` by the server/database, never the client.

## M3 — Tables & data (admin)
- `table_metadata`, `data_rows` schema + RLS.
- Create table, edit columns, browse/search/sort/paginate, inline edit,
  clear table, delete table.
- **Acceptance**: creating a table with 3 columns, adding 100 rows, editing
  one, clearing, and deleting all work end-to-end with correct audit entries.

## M4 — Import / export
- CSV/XLSX/JSON import with validation preview, append and replace-all,
  transactional writes, `import_jobs` history.
- CSV export.
- **Acceptance**: an import with 1 intentionally bad row out of 500 is fully
  rejected (0 rows written) and the preview correctly flags the bad row.

## M5 — Employee permissions
- `data_permissions` CRUD (admin-only), employee workspace limited to
  granted tables/operations.
- **Acceptance**: an employee granted `can_view` only on Table A cannot see
  Table B and cannot edit Table A, verified via both UI and direct API call.

## M6 — Founder console
- Company list, activate/suspend/restore, plan/trial management, manual
  payment approval queue, platform audit log.
- **Acceptance**: suspending a company blocks that company's admin/employee
  logins (or at least all data operations) without deleting their data.

## M7 — Polish & deploy
- Mobile-optimized nav/tables, empty/loading/error states, confirmation
  dialogs on all destructive actions, accessibility pass.
- Vercel production deployment, pointed at the production Supabase project.
- **Acceptance**: a full founder → company → admin → employee → data flow
  works on a Vercel preview deployment on both desktop and mobile viewports.
