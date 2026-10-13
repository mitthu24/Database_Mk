# Product Requirements Document — Tabular Data Management SaaS

## 1. Problem & audience

Small and medium-sized businesses (e.g. manufacturing operations tracking
inventory, orders, production batches, vendors) need a simple, spreadsheet-like
system to maintain structured business data online, without the overhead of a
full database admin tool or a custom-built internal app.

## 2. Product summary

A multi-tenant SaaS where each customer ("company") gets its own workspace to
define tables, import/manage data, and control who on their team can see or
edit what — administered top-down by a platform operator ("founder").

## 3. Roles

| Role | Scope |
|---|---|
| Founder (super admin) | Entire platform: all companies, plans, trials, payments, audit log |
| Company Admin | One company: its employees, tables, data, imports, exports |
| Employee | One company, limited to tables/operations explicitly granted to them |

## 4. Core user journeys

### Founder
- Create a company and its first admin account (manual provisioning).
- Activate / suspend / restore a company.
- View and approve manual payments; manage plan + trial state.
- View platform-wide audit log.
- Change own password securely.

### Company Admin
- Edit company profile.
- Create / deactivate employee accounts; assign per-table permissions.
- Create a logical table: name + column definitions (name, type, required).
- Import data: CSV / XLSX / JSON, with a validation preview before commit.
- Append new rows to an existing table (validated against its schema).
- Replace all rows in a table (transactional — all or nothing).
- Edit table name / column definitions.
- Clear all rows in a table (destructive, confirmation required).
- Delete a table entirely (destructive, confirmation required).
- Browse table data: search, filter, sort, paginate, inline edit, export (CSV).
- View import history and relevant audit log entries.
- Change own password securely.

### Employee
- See only the tables/operations an admin has explicitly granted.
- Perform only the granted operations (view, edit, import, export — never
  structural changes like deleting a table, unless explicitly escalated).

## 5. Non-functional requirements

- Responsive: desktop, tablet, and a native-app-like feel on mobile (touch
  targets, compact nav, fast table interactions).
- Tenant data is fully isolated — one company can never read or write
  another company's data, enforced at the database layer (RLS), not just in
  application code.
- Destructive operations (clear table, delete table, replace-all) require
  explicit confirmation and are logged.
- Imports are validated (type, size, header match, row limits) before any
  data is written, and are atomic (all rows succeed or the import is rolled
  back).
- No service-role credentials or database passwords are ever sent to the
  browser.

## 6. Out of scope for MVP

- Real-time collaborative editing (multiple users editing the same row
  simultaneously with live cursors).
- Formulas / computed columns.
- Billing automation (MVP uses manual payment approval by the founder).
- Public API for third-party integrations.

## 7. Success criteria (MVP)

- A founder can provision a company and its first admin without touching
  the database directly.
- A company admin can create a table, import a CSV of a few thousand rows,
  and browse/search it with sub-second response.
- An employee with view-only access cannot modify data, confirmed by both
  UI behavior and a direct API/RLS test.
- No cross-tenant data leak under automated RLS tests (see
  `04-tenant-isolation.md`).
