-- M1 / 01 — tenancy core tables.
--
-- STATUS: DRAFT — NOT APPLIED to any Supabase project. The live schema of
-- project evgwjbyrmuljrccgtedi has not been inspected yet (see
-- docs/m1-implementation-notes.md). Review against the live schema first.
--
-- Deliberately strict: no "or replace" and no "if not exists" on tables and
-- functions, so a name clash with an existing live object makes the migration
-- fail instead of silently overwriting something.
--
-- Deferred on purpose (later milestones): import_jobs (M4), manual_payments (M6).

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- profiles: one row per auth user. Created only by trigger (see 04).
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint profiles_full_name_len check (full_name is null or char_length(full_name) <= 120)
);

-- ---------------------------------------------------------------------------
-- founders: platform operators. No client role may read or write this table.
-- ---------------------------------------------------------------------------
create table public.founders (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  granted_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- companies: tenant identity + suspension state only. Plan/trial live in
-- subscriptions (single source of truth).
-- ---------------------------------------------------------------------------
create table public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  status      text not null default 'active',
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint companies_name_len check (char_length(btrim(name)) between 2 and 120),
  constraint companies_status_valid check (status in ('active', 'suspended'))
);

-- ---------------------------------------------------------------------------
-- company_members: MVP rule — a user belongs to exactly one company.
-- ---------------------------------------------------------------------------
create table public.company_members (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  role           text not null,
  status         text not null default 'active',
  employee_code  text,
  created_by     uuid references auth.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint company_members_role_valid check (role in ('admin', 'employee')),
  constraint company_members_status_valid check (status in ('active', 'disabled')),
  constraint company_members_code_fmt check (employee_code is null or employee_code ~ '^[A-Za-z0-9._-]{1,32}$'),
  constraint company_members_user_key unique (user_id),
  constraint company_members_company_user_key unique (company_id, user_id)
);
create unique index company_members_company_code_key
  on public.company_members (company_id, lower(employee_code))
  where employee_code is not null;
create index company_members_company_idx on public.company_members (company_id);

-- ---------------------------------------------------------------------------
-- subscriptions: trial dates are computed by column defaults, never by clients
-- (clients have no INSERT/UPDATE privilege on this table).
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null unique references public.companies (id) on delete cascade,
  plan                text not null default 'trial',
  status              text not null default 'trialing',
  trial_started_at    timestamptz not null default now(),
  trial_ends_at       timestamptz not null default (now() + interval '30 days'),
  current_period_end  timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint subscriptions_plan_fmt check (plan ~ '^[a-z][a-z0-9_]{1,31}$'),
  constraint subscriptions_status_valid check (status in ('trialing', 'active', 'past_due', 'canceled')),
  constraint subscriptions_trial_order check (trial_ends_at > trial_started_at)
);

-- ---------------------------------------------------------------------------
-- table_metadata: one row per customer "logical table". No physical table is
-- ever created per customer table.
-- ---------------------------------------------------------------------------
create table public.table_metadata (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null,
  columns     jsonb not null default '[]'::jsonb,
  row_count   bigint not null default 0,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint table_metadata_name_len check (char_length(btrim(name)) between 1 and 120),
  constraint table_metadata_columns_array check (jsonb_typeof(columns) = 'array' and jsonb_array_length(columns) <= 200),
  constraint table_metadata_id_company_key unique (id, company_id)
);
create unique index table_metadata_company_name_key on public.table_metadata (company_id, lower(name));

-- ---------------------------------------------------------------------------
-- data_permissions: per-employee, per-table grants. Composite foreign keys
-- make cross-tenant rows structurally impossible.
-- ---------------------------------------------------------------------------
create table public.data_permissions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  user_id     uuid not null,
  table_id    uuid not null,
  can_view    boolean not null default false,
  can_create  boolean not null default false,
  can_edit    boolean not null default false,
  can_delete  boolean not null default false,
  can_import  boolean not null default false,
  can_export  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint data_permissions_table_user_key unique (table_id, user_id),
  constraint data_permissions_table_fk foreign key (table_id, company_id)
    references public.table_metadata (id, company_id) on delete cascade,
  constraint data_permissions_member_fk foreign key (company_id, user_id)
    references public.company_members (company_id, user_id) on delete cascade,
  constraint data_permissions_view_required check (
    can_view or not (can_create or can_edit or can_delete or can_import or can_export)
  )
);
create index data_permissions_user_idx on public.data_permissions (user_id);

-- ---------------------------------------------------------------------------
-- data_rows: JSONB row storage (see docs/03-database-schema.md).
-- ---------------------------------------------------------------------------
create table public.data_rows (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null,
  table_id    uuid not null,
  row_order   bigint generated always as identity,
  data        jsonb not null default '{}'::jsonb,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint data_rows_table_fk foreign key (table_id, company_id)
    references public.table_metadata (id, company_id) on delete cascade,
  constraint data_rows_data_object check (jsonb_typeof(data) = 'object'),
  constraint data_rows_data_size check (pg_column_size(data) <= 65536)
);
create index data_rows_table_order_idx on public.data_rows (table_id, row_order);
create index data_rows_data_gin_idx on public.data_rows using gin (data jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- audit_logs: append-only. No FK to companies/users so history survives
-- deletion of either.
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id           bigint generated always as identity primary key,
  company_id   uuid,
  actor_id     uuid,
  action       text not null,
  target_type  text,
  target_id    uuid,
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  constraint audit_logs_action_len check (char_length(action) between 1 and 80)
);
create index audit_logs_company_created_idx on public.audit_logs (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create function private.set_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger set_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.companies
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.company_members
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.subscriptions
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.table_metadata
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.data_permissions
  for each row execute function private.set_updated_at();
create trigger set_updated_at before update on public.data_rows
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- audit_logs immutability (defence in depth on top of missing privileges)
-- ---------------------------------------------------------------------------
create function private.audit_logs_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_logs is append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_no_update_delete before update or delete on public.audit_logs
  for each row execute function private.audit_logs_immutable();
create trigger audit_logs_no_truncate before truncate on public.audit_logs
  for each statement execute function private.audit_logs_immutable();

-- Trigger functions need no EXECUTE grant to fire; remove the default PUBLIC one.
revoke all on function private.set_updated_at() from public, anon, authenticated;
revoke all on function private.audit_logs_immutable() from public, anon, authenticated;
