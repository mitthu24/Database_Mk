# Technical Architecture

## Stack

- **Frontend/app**: Next.js (App Router) + TypeScript, Tailwind CSS, a
  hand-rolled shadcn/ui-style component layer (`src/components/ui`), Lucide
  icons.
- **Backend**: Next.js server (Route Handlers / Server Actions) + Supabase
  Postgres as the system of record.
- **Auth**: Supabase Auth, email + password.
- **Authorization**: Postgres Row Level Security (RLS) as the hard boundary,
  with server-side checks in Next.js as a second layer (never rely on the
  client to self-report role/company).
- **Hosting**: Vercel (app), Supabase (database + auth).
- **Source control**: GitHub, with Claude Code assisting development.

## High-level request flow

```
Browser (Next.js client components)
   │  fetch / Server Actions
   ▼
Next.js server (Route Handlers, Server Actions, Server Components)
   │  supabase-js (server client, user's JWT forwarded via cookies)
   ▼
Supabase Postgres  — RLS evaluates auth.uid() + company_members on every query
```

Two Supabase clients are used (see `src/lib/supabase/`):
- **Browser client** (`client.ts`) — anon key only, used in client components
  for session-aware reads where RLS is sufficient on its own.
- **Server client** (`server.ts`, `middleware.ts`) — anon key, but running
  server-side with the user's cookies, used in Server Components/Actions.
- A **service-role client** (server-only, never imported into any file that
  ships to the browser) is reserved for the narrow set of operations RLS
  cannot express itself, e.g. founder-only cross-tenant provisioning. Every
  service-role operation must perform its own explicit authorization check
  in code before touching data — RLS does not protect you here because the
  service role bypasses it by design.

## Why RLS first

Application-level "if (user.role === 'admin')" checks are necessary for UX
(hiding buttons, returning clean errors) but are not sufficient for security:
a bug in one code path must not become a cross-tenant data leak. RLS policies
scoped to `company_id` make the database itself refuse the query, independent
of which code path reached it. See `04-tenant-isolation.md` for the policy
design.

## Environments

- **Local dev**: `supabase` CLI + local Postgres (recommended once network
  access to Supabase is available in your dev environment), or point
  directly at a Supabase dev project.
- **Preview**: Vercel preview deployments per branch/PR, pointed at a
  Supabase dev/staging project.
- **Production**: Vercel production deployment, pointed at the production
  Supabase project (`evgwjbyrmuljrccgtedi`).

## Migrations

All schema changes live as timestamped SQL files under `supabase/migrations/`
(created once Supabase CLI/MCP access is available — see
`06-backup-migration-rollback.md`). Migrations are the only way schema
changes reach any environment; no manual dashboard edits in production.
