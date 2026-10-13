# Tenant Isolation & Row Level Security Rules

> **M1 update:** the helper functions below are implemented in the `private`
> schema (not API-exposed) with `search_path = ''`, restricted `EXECUTE`, and
> two additions (`company_can_read`, `company_can_write`) that enforce
> suspension and expired-trial read-only mode. The founder has **no** access to
> customer data tables. The SQL in the migrations and the behaviour documented
> in `m1-implementation-notes.md` supersede the sketches here; the isolation
> properties are asserted by `npm run test:db`.

## Principles

1. Every tenant-scoped table carries a `company_id` column, even where it
   could be derived via a join (e.g. `data_rows.company_id`), so RLS policies
   can filter on it directly without a subquery on every row.
2. RLS is enabled on every tenant-scoped table with **no default-allow
   policy** — access exists only where a policy explicitly grants it.
3. Founders bypass per-company scoping only through policies that check
   membership in `founders`, never by disabling RLS or using the service
   role in normal request paths.
4. The service-role key is only ever used server-side, for the few actions
   that must legitimately cross tenants (e.g. founder creating a new
   company + its first admin). Every such code path re-checks "is this
   caller actually a founder?" in application code before acting, since the
   service role itself bypasses RLS.

## Helper functions (used inside policies)

```sql
-- true if the current user is a member of the given company
create function is_company_member(target_company uuid) returns boolean
  language sql security definer stable as $$
    select exists (
      select 1 from company_members
      where company_id = target_company and user_id = auth.uid()
    );
  $$;

-- true if the current user is a company admin for the given company
create function is_company_admin(target_company uuid) returns boolean
  language sql security definer stable as $$
    select exists (
      select 1 from company_members
      where company_id = target_company
        and user_id = auth.uid()
        and role = 'admin'
    );
  $$;

-- true if the current user is a platform founder
create function is_founder() returns boolean
  language sql security definer stable as $$
    select exists (select 1 from founders where user_id = auth.uid());
  $$;
```

## Policy shape per table (summary)

| Table | SELECT | INSERT/UPDATE/DELETE |
|---|---|---|
| `companies` | member of the company, or founder | admin of the company (profile fields only), founder (status/plan/trial) |
| `company_members` | member of the same company, or founder | admin of the company, or founder |
| `table_metadata` | member of the company, or founder | admin of the company |
| `data_rows` | member with `can_view` via `data_permissions` (admins implicitly allowed), or founder | member with `can_edit`/`can_import` as applicable; admins implicitly allowed |
| `data_permissions` | admin of the company, or founder | admin of the company |
| `import_jobs` | member of the company, or founder | written by server-side code on behalf of an authorized member |
| `audit_logs` | admin of the company (company-scoped rows only), founder (all rows) | insert-only, written by server-side code, never by the client directly |
| `subscriptions`, `manual_payments` | admin of the company, or founder | founder only (approvals), admin can create a manual payment submission |
| `founders` | founder only | not writable via any client-facing role; provisioned out-of-band |

## Why "admin implicitly allowed" on `data_rows`

Company admins have full rights over their own company's data by
definition — requiring an explicit `data_permissions` row for every admin on
every table would be redundant bookkeeping. The policy therefore checks
`is_company_admin(company_id) OR (is_company_member AND exists a matching,
sufficiently-permissive data_permissions row)`.

## Testing tenant isolation

Before any release, an automated check (e.g. a small script run against a
test project) must confirm, using real Supabase Auth sessions for two
different companies' users:
- User A cannot `SELECT` any `data_rows`/`table_metadata` belonging to
  Company B, by ID or by listing.
- User A cannot `INSERT`/`UPDATE`/`DELETE` into Company B's rows even if
  they know a valid `table_id`/`row id` (no insecure direct object
  reference).
- An employee without `can_edit` on a table cannot write to it, even though
  they can read it.
