-- Local test harness: a MINIMAL emulation of the Supabase pieces the M1
-- migrations depend on. This is plain PostgreSQL, NOT a Supabase project.
-- Results from this harness prove the SQL/RLS logic; they do not prove the
-- live Supabase project (see docs/m1-implementation-notes.md).

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end $$;

create schema auth;
create table auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text,
  raw_user_meta_data  jsonb not null default '{}'::jsonb,
  email_confirmed_at  timestamptz,
  created_at          timestamptz not null default now()
);

-- Same definition Supabase ships.
create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

-- Supabase's permissive defaults: every new public table/sequence/function is
-- granted to the API roles. The migrations must narrow these explicitly.
alter default privileges for role postgres in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Test helpers (schema "test" is callable by every role under test)
-- ---------------------------------------------------------------------------
create schema test;
grant usage on schema test to public;

create table test.ids (name text primary key, id uuid not null);
create function test.id(p_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select id from test.ids where name = p_name
$$;
grant execute on function test.id(text) to public;

create function test.login(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_user::text, false);
  execute 'set role authenticated';
end $$;

create function test.anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'set role anon';
end $$;

create function test.service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  execute 'set role service_role';
end $$;

create function test.logout() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', false);
end $$;

grant execute on function test.login(uuid), test.anon(), test.service(), test.logout() to public;

create function test.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'FAIL: %', p_msg;
  end if;
  raise notice 'PASS: %', p_msg;
end $$;
grant execute on function test.ok(boolean, text) to public;

-- Runs p_stmt under the CURRENT role and asserts it raises p_state.
create function test.throws(p_stmt text, p_state text, p_msg text) returns void language plpgsql as $$
declare
  v_state text;
begin
  begin
    execute p_stmt;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  if v_state is null then
    raise exception 'FAIL: % (statement succeeded, expected SQLSTATE %)', p_msg, p_state;
  elsif v_state <> p_state then
    raise exception 'FAIL: % (got SQLSTATE %, expected %)', p_msg, v_state, p_state;
  end if;
  raise notice 'PASS: %', p_msg;
end $$;
grant execute on function test.throws(text, text, text) to public;

-- Row count of a SELECT under the CURRENT role (RLS applies).
create function test.count(p_select text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute 'select count(*) from (' || p_select || ') t' into n;
  return n;
end $$;
grant execute on function test.count(text) to public;

-- Rows affected by a DML statement under the CURRENT role (RLS applies).
create function test.affected(p_dml text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_dml;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function test.affected(text) to public;
