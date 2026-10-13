# Backup, Migration & Rollback Strategy

## Migrations

- All schema changes are plain SQL files under `supabase/migrations/`,
  timestamp-ordered, applied via the Supabase CLI (`supabase db push`) or
  Supabase MCP once connected — never hand-edited directly on the
  dashboard in any environment that matters.
- Each migration is additive wherever possible (add column nullable, backfill,
  then tighten constraints in a follow-up migration) so a deploy can go out
  without a maintenance window.
- Migrations are reviewed the same as application code before being applied
  anywhere beyond a disposable local/dev project.

## Environments & promotion

```
local/dev project  →  staging/preview project  →  production project (evgwjbyrmuljrccgtedi)
```
A migration is applied to dev first, exercised there, then promoted. No
migration goes straight to production.

## Backups

- Rely on Supabase's built-in automated backups for the production project
  as the baseline; confirm the plan's backup retention window once connected
  via MCP/dashboard and document it here.
- Before any destructive migration (dropping/renaming a column or table,
  changing a type in a way that can lose data), take an explicit manual
  backup/snapshot first, in addition to the automatic ones, and note the
  snapshot reference in the PR/commit that ships the migration.

## Rollback

- Every migration that can reasonably be reversed ships with a paired "down"
  note (even if Supabase's workflow doesn't auto-apply a down migration):
  what manual SQL or restore step undoes it.
- For destructive changes with no clean reverse (e.g. a dropped column),
  rollback means restoring from the pre-migration backup — which is why the
  manual snapshot step above is mandatory for that class of change.
- Application deploys (Vercel) are rolled back independently and instantly
  via Vercel's deployment history; schema rollback and app rollback are
  planned together when a change touches both, since an old app build
  talking to a new schema (or vice versa) must stay compatible for the
  duration of a rollback window.

## Never-do list

- Never run `supabase db reset` or any destructive command against the
  production project.
- Never disable RLS "temporarily" to debug something in production.
- Never apply an untested migration directly to production.
