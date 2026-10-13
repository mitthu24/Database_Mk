# Tabular Data Management SaaS

Multi-tenant SaaS letting small/medium businesses maintain business data in
spreadsheet-style tables, with a founder/company-admin/employee role model.

See [`docs/`](./docs) for the full product requirements, technical
architecture, database schema, tenant-isolation rules, role/permission
matrix, data workflows, and backup/migration strategy.

## Stack

Next.js (App Router) + TypeScript, Tailwind CSS, a hand-rolled
shadcn/ui-style component layer, Supabase (Postgres + Auth), Vercel.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in real Supabase project values
npm run dev
```

Visit `/setup` to verify your environment is configured correctly (it
reports whether required env vars are set and whether Supabase Auth is
reachable — it never displays secret values).

## Project status

This repository currently has the foundation in place (M0 in
[`docs/08-milestones.md`](./docs/08-milestones.md)):

- Next.js/TypeScript/Tailwind scaffold, lint and build verified.
- Base UI components (`src/components/ui`) in a shadcn/ui-compatible shape.
- Supabase client setup for browser, server, and middleware/proxy
  (`src/lib/supabase/`), using placeholder env vars only.
- `/setup` environment verification page.
- Full architecture/schema/security docs under `docs/`.

**Not yet done, and blocked on external connections:**
- No migrations have been applied to the live Supabase project
  (`evgwjbyrmuljrccgtedi`) — this session's network policy currently blocks
  `supabase.com` and no Supabase MCP connector is attached. See
  `docs/02-technical-architecture.md` and `docs/07-backup-migration-rollback.md`.
- No Vercel project link/deployment yet — no Vercel auth available in this
  session.
- The founder bootstrap account must be created via Supabase Auth directly
  (dashboard or a trusted server-side script), never hardcoded in source.

## Scripts

```bash
npm run dev        # start dev server
npm run build      # production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
npm test           # unit tests (Vitest)
npm run test:db    # RLS/SQL tests on a throwaway local PostgreSQL (needs postgres server binaries)
```

M1 (auth + multi-tenant database foundation) is prepared but **not applied** to
any Supabase project. Start with
[`docs/m1-implementation-notes.md`](./docs/m1-implementation-notes.md).

## Environment variables

See [`.env.example`](./.env.example). `.env.local` is git-ignored; never
commit real credentials. The service-role key must only ever be read by
server-side code.
