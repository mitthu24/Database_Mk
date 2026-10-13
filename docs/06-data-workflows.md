# Data Workflows: Import, Append, Replace, Clear, Delete, Export

## Import (shared first stage for append and replace)

1. Client uploads a file (CSV, XLSX, or JSON) to a server endpoint — never
   parsed client-side as the source of truth, since validation must be
   trusted server-side.
2. Server validates, before touching any data:
   - File type (by content, not just extension) and file size limit.
   - Header row matches the target table's `columns` (by key), with a clear
     diff of missing/extra/renamed columns shown back to the user.
   - Row count against a configured max-rows-per-import limit.
   - Per-cell type checking against each column's declared type; required
     columns must be non-empty.
3. Server returns a **preview**: counts of valid rows, a sample of rows that
   would be rejected and why, before anything is committed.
4. User confirms → server performs the actual write (append or replace,
   below) inside a transaction, then writes one `import_jobs` row and one
   `audit_logs` row recording the outcome.
5. If any step after confirmation fails, the transaction rolls back
   entirely — a failed import never leaves a table half-written.

## Append

- Runs inside a transaction: validate all rows first (per above), then
  `INSERT` all rows into `data_rows` for that `table_id`, then update
  `table_metadata.row_count`.
- Never partially applies an import — if row 900 of 1,000 fails validation,
  none of the 1,000 are written (the preview step should have already
  caught this, but the transaction is the real guarantee).

## Replace all

- Admin-only, requires an explicit typed confirmation (e.g. typing the table
  name) given it discards existing data.
- Runs inside a single transaction: validate the new data fully, insert the
  new rows, then delete the previous rows for that `table_id` (or insert new
  + flip a pointer + delete old, if minimizing lock time on large tables
  becomes necessary) — all inside the same transaction so a failure leaves
  the original data untouched.
- Writes an `audit_logs` entry capturing the previous row count for
  traceability.

## Clear all records

- Admin-only, explicit confirmation dialog ("This will permanently delete
  all N rows in *Vendors*. This cannot be undone.").
- `DELETE FROM data_rows WHERE table_id = $1` inside a transaction; resets
  `table_metadata.row_count` to 0.
- Logged to `audit_logs` with the row count that was cleared.

## Delete table

- Admin-only, explicit confirmation (typed table name).
- Deletes the `table_metadata` row (cascades to `data_rows`,
  `data_permissions`, and is referenced-but-preserved in `import_jobs`/
  `audit_logs` via `target_id`, not a hard FK, so history survives deletion).
- Logged to `audit_logs`.

## Search / filter / sort / edit (browsing)

- Server-side pagination (default page size tuned for the UI, e.g. 50 rows),
  never "load everything then filter in the browser" once a table grows
  past a small size.
- Search/filter translate to JSONB queries scoped by `table_id` +
  `company_id` (always both — never trust a client-supplied `table_id`
  alone; RLS backs this up but the query itself should also scope
  correctly for performance).
- Inline edits go through the same column-type validation as import, applied
  to a single row.

## Export

- Server streams matching rows (respecting any active filter) to CSV,
  scoped by `table_id` + `company_id`, authorized by the same
  `data_permissions.can_export` check as viewing.
- Large exports are streamed rather than buffered fully in memory.
- Export actions are logged to `audit_logs` (who exported what, when, and
  how many rows) since exported data leaves the controlled table view.
