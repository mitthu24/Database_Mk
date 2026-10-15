# M10 — Vercel deployment checklist

This covers Vercel configuration and the preview → production deployment
sequence. It assumes `docs/11-hosted-supabase-cutover.md` has already been
completed for whichever Supabase project (dev or production) the
deployment targets. **No Vercel link, preview deploy, or production
deploy has been performed by the assistant.** `vercel login`/`vercel link`
must be done by you; this document is the checklist for when you do.

## Required environment variables per Vercel environment

| Variable | Production | Preview | Development |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Production project URL — **leave unset until production is verified** (app refuses to start without it, by design) | Dev project URL | Dev project URL or local |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production anon key (set only after verification) | Dev anon key | Dev anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Production key, sensitive — set only after verification | Dev key, sensitive | Dev key |
| `NEXT_PUBLIC_SITE_URL` | `https://<production domain>` — **required**, app refuses to start without an `https://` value in production | Optional (falls back to `VERCEL_URL`) | `http://localhost:3000` |
| `PRODUCTION_SUPABASE_PROJECT_REF` | The verified production ref — **required in every environment**, including preview and development, so each can refuse to accidentally point at production | Same value as production | Same value as production |
| `APP_BACKEND` | **Unset.** `mock` is refused automatically when `VERCEL_ENV=production`, but don't rely on that — never set it in a real deployment's env vars | Unset for a real preview against hosted Supabase | `mock` is fine locally for development without touching Supabase at all |

The fail-closed guard (`src/lib/supabase/config.ts`, confirmed by this
audit's reading in `docs/10-final-readiness-audit.md` §2) means: production
needs `PRODUCTION_SUPABASE_PROJECT_REF` set and an exact
`https://<ref>.supabase.co` match, or the app refuses to start; any
non-production environment is also refused if its configured URL points at
the production ref. This was unit-tested and exercised in a running server
in prior milestones — not re-derived here, confirmed still present.

## Pre-deploy checklist

- [ ] Vercel Deployment Protection enabled for preview deployments (keeps
      previews from being publicly crawlable/guessable while still pointed
      at a real, if non-production, Supabase project).
- [ ] `.vercel/` confirmed git-ignored (already the case — verify it stays
      that way).
- [ ] All required env vars above set for the target environment, through
      the Vercel dashboard or CLI — never committed to the repo, never
      pasted into chat.
- [ ] `docs/11-hosted-supabase-cutover.md` steps 1-6 completed and recorded
      for whichever Supabase project (dev, for a preview; production, for
      a production deploy) this deployment will use.
- [ ] The full local gate re-run clean immediately before this deploy:
      `npm run typecheck && npm run lint && npx vitest run && npm run build`.

## Preview deployment procedure

1. Push the branch; Vercel auto-builds a preview (or run `vercel deploy`
   locally if preview-on-push isn't configured).
2. Preview env vars point at the **development** Supabase project only —
   never production — per the table above.
3. Smoke-test the preview URL manually: register a real account against
   the dev project, confirm the email arrives, sign in, create a table,
   import/export a file, sign out. This is the first time any of this runs
   against a real deployed Vercel edge function + real hosted Supabase
   together; local `next build && next start` does not reproduce Vercel's
   own network path.
4. Confirm `/setup` (if left reachable on preview — it 404s on
   `VERCEL_ENV=production` by design) reports every check green.
5. Record results. Do not report a preview as "verified" without actually
   opening it and completing the smoke test — this is exactly the
   distinction the standing instructions require.

## Promotion to production

Only after a preview deployment against the **production** Supabase
project (not dev) has been smoke-tested successfully, or after an
equivalent explicit decision to promote:

1. Re-confirm the production Supabase project backup/PITR is current.
2. Set the production environment variables (table above) in Vercel.
3. Deploy to production (`vercel --prod` or the dashboard's promote
   action) — **requires your explicit approval**, per the standing
   instruction never to deploy to production Vercel without it.
4. Immediately smoke-test the live production URL the same way as the
   preview smoke test above.
5. Watch error/log output (Vercel's function logs, Supabase's log
   explorer) for the first real traffic.

## Rollback and recovery (Vercel side)

- Vercel keeps prior deployments; "Promote to Production" on a previous
  known-good deployment is the fastest rollback if a new deploy regresses
  — this does not touch the database, only which built app serves traffic.
- A database-level rollback is a separate, slower, and more dangerous
  action — see `docs/11-hosted-supabase-cutover.md`'s rollback section. Do
  not reach for a migration rollback to fix an application-level bug; redeploy
  the previous build instead.
- If a bad environment variable (e.g., a wrong `PRODUCTION_SUPABASE_PROJECT_REF`)
  causes production to refuse to start, that is the fail-closed guard
  working as intended — fix the variable and redeploy, don't bypass the
  guard.

## Known limitations going into deployment

- No Vercel project has been linked or deployed to by the assistant in any
  session. This checklist has not itself been executed.
- The local `next build && next start` verification used throughout
  `docs/09-build-status.md` and `docs/10-final-readiness-audit.md` does
  not reproduce Vercel's edge network, cold starts, or regional
  deployment — the preview smoke test above is the first real check of
  that.
- Vercel Deployment Protection, custom domain/DNS setup, and any CDN/edge
  caching rules for the marketing pages are not covered here in detail —
  they are standard Vercel configuration outside this app's own code and
  should be confirmed against current Vercel documentation at deploy time.
