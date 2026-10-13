# Database Schema & Storage Design

> These are proposed tables, not yet applied. Before running any migration,
> inspect the live project (`evgwjbyrmuljrccgtedi`) via Supabase MCP/CLI once
> that connection is available, and reconcile this design against whatever
> already exists there.
>
> **M1 update:** the design below was adapted when the migrations were written
> (`supabase/migrations/20261013160*`). Differences: trial/plan dates live in
> `subscriptions` only (not `companies`); `import_jobs` and `manual_payments`
> are deferred to M4/M6; `data_permissions` has per-operation flags (view,
> create, edit, delete, import, export); one company per user; composite
> foreign keys enforce tenant consistency. The migrations and
> `m1-implementation-notes.md` are authoritative where they differ from the
> sketch below.

## Storage model decision: metadata + JSONB rows (hybrid)

**Rejected approach**: `CREATE TABLE` per customer-defined table. This does
not scale operationally (migrations, backups, connection/catalog overhead
all grow per-tenant-table), makes adding/renaming columns a schema migration
instead of a metadata update, and makes cross-tenant tooling (search,
export, audit) inconsistent since every tenant's physical schema differs.

**Chosen approach**: a small fixed set of physical tables, where each
customer "table" is a row in `table_metadata` (name + column definitions as
JSON), and its actual data rows live in a single `data_rows` table as JSONB,
scoped by `table_id` and `company_id`.

| Concern | How it's handled |
|---|---|
| Schema validation | Column defs (name, type, required, order) stored in `table_metadata.columns`; validated in application code against each row's JSON on insert/update using those definitions (and reinforced by a Postgres CHECK/trigger for required fields) |
| Indexing | `data_rows(company_id, table_id)` btree index for all list/search queries; GIN index on the JSONB `data` column for ad-hoc filtering; frequently-filtered columns can get a generated column + btree index as a later optimization if a specific table proves hot |
| Pagination | Standard keyset or offset pagination on `data_rows` ordered by `row_order`/`created_at`, scoped by `table_id` |
| Import transactions | Each import (append or replace) runs inside a single Postgres transaction; replace = delete-then-insert (or insert-new/swap/delete-old) inside one transaction so a failure leaves the old data intact |
| Search/filter | JSONB containment/`->>'field'` queries for MVP scale (tens of thousands of rows per table); revisit with a dedicated search index or a typed-column projection if a tenant's table grows large enough to need it |
| Export | Stream rows for a `table_id` ordered consistently, serialize to CSV server-side |
| Retention / audit | Every structural or destructive action (create/edit/clear/delete table, replace-all, import) is written to `audit_logs`; `import_jobs` keeps a durable record of each import's outcome |

This hybrid trades a small amount of per-query JSON overhead for a design
that scales to many tenants/tables without a growing number of physical
objects, and keeps schema changes (add/rename a customer's column) as plain
metadata updates instead of `ALTER TABLE`s. If a specific customer table
later needs heavy analytical querying, it can be promoted to a dedicated
typed table without changing the product's data model for everyone else.

## Proposed tables

```
profiles
  id            uuid PK, references auth.users(id)
  email         text
  full_name     text
  created_at    timestamptz

companies
  id            uuid PK
  name          text
  status        text        -- active | suspended | trial_expired
  plan          text
  trial_ends_at timestamptz -- set server-side on signup: now() + interval '30 days'
  created_at    timestamptz

company_members
  id            uuid PK
  company_id    uuid FK -> companies.id
  user_id       uuid FK -> profiles.id
  role          text        -- 'admin' | 'employee'
  created_at    timestamptz
  UNIQUE (company_id, user_id)

founders
  user_id       uuid PK FK -> profiles.id
  -- presence of a row = founder. Never writable from a public endpoint.

table_metadata
  id            uuid PK
  company_id    uuid FK -> companies.id
  name          text
  columns       jsonb       -- [{ key, label, type, required, order }]
  row_count     integer     -- maintained via trigger, avoids COUNT(*) on read
  created_by    uuid FK -> profiles.id
  created_at    timestamptz
  updated_at    timestamptz

data_rows
  id            uuid PK
  company_id    uuid FK -> companies.id   -- denormalized for RLS + index locality
  table_id      uuid FK -> table_metadata.id
  data          jsonb
  row_order     bigint
  created_at    timestamptz
  updated_at    timestamptz

data_permissions
  id            uuid PK
  company_id    uuid FK -> companies.id
  user_id       uuid FK -> profiles.id    -- an employee
  table_id      uuid FK -> table_metadata.id
  can_view      boolean
  can_edit      boolean
  can_import    boolean
  can_export    boolean

import_jobs
  id            uuid PK
  company_id    uuid FK -> companies.id
  table_id      uuid FK -> table_metadata.id
  mode          text        -- 'append' | 'replace'
  source_file   text        -- original filename
  status        text        -- 'validating' | 'succeeded' | 'failed'
  row_count     integer
  error_summary text
  created_by    uuid FK -> profiles.id
  created_at    timestamptz

audit_logs
  id            uuid PK
  company_id    uuid        -- nullable for platform-level (founder) events
  actor_id      uuid FK -> profiles.id
  action        text        -- e.g. 'table.delete', 'table.replace_all'
  target_type   text
  target_id     uuid
  metadata      jsonb
  created_at    timestamptz

subscriptions
  id            uuid PK
  company_id    uuid FK -> companies.id
  plan          text
  status        text
  current_period_end timestamptz

manual_payments
  id            uuid PK
  company_id    uuid FK -> companies.id
  amount        numeric
  currency      text
  proof_reference text
  status        text        -- 'pending' | 'approved' | 'rejected'
  reviewed_by   uuid FK -> profiles.id
  created_at    timestamptz
```

## ER overview

```
companies 1───* company_members *───1 profiles
companies 1───* table_metadata 1───* data_rows
companies 1───* data_permissions ───> profiles, table_metadata
companies 1───* import_jobs ───> table_metadata
companies 1───* audit_logs
companies 1───1 subscriptions
companies 1───* manual_payments
profiles  1───1 founders (optional row)
```
