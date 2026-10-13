-- M1 / 04 — auth trigger, registration + context + export-gate RPCs, founder ops.
--
-- STATUS: DRAFT — NOT APPLIED. See 01 for the review gate.
--
-- API surface (public schema => exposed by PostgREST):
--   register_company(name)            authenticated
--   get_my_context()                  authenticated
--   authorize_export(table_id)        authenticated
--   founder_set_company_status(...)   authenticated, checks is_founder() inside
--   founder_set_subscription(...)     authenticated, checks is_founder() inside
-- Operator-only (private schema, executed from the Supabase SQL editor as the
-- postgres role; no API role can execute them):
--   private.grant_founder(email), private.revoke_founder(email)

-- ---------------------------------------------------------------------------
-- Profile creation. Only identity fields are copied; role / company / any
-- privilege-looking metadata supplied at signup is ignored by construction.
-- ---------------------------------------------------------------------------
create function private.handle_new_user() returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120), '')
  );
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Backfill for users that already exist in the project (review before apply:
-- this inserts rows; it never modifies or deletes existing data).
insert into public.profiles (id, email, full_name)
select u.id, u.email, nullif(left(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', '')), 120), '')
from auth.users u
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- register_company: atomic company + admin membership + 30-day trial.
-- A single function call is a single transaction: any failure rolls back all
-- three inserts. Trial dates come from column defaults (server clock).
-- ---------------------------------------------------------------------------
create function public.register_company(p_name text) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_company uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(v_name) not between 2 and 120 then
    raise exception 'company name must be 2-120 characters' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null
  ) then
    raise exception 'email address is not confirmed' using errcode = '42501';
  end if;
  if exists (select 1 from public.founders f where f.user_id = v_uid) then
    raise exception 'founder accounts cannot own a company' using errcode = '42501';
  end if;
  if exists (select 1 from public.company_members m where m.user_id = v_uid) then
    raise exception 'user already belongs to a company' using errcode = '23505';
  end if;

  insert into public.companies (name, created_by)
  values (v_name, v_uid)
  returning id into v_company;

  insert into public.company_members (company_id, user_id, role, created_by)
  values (v_company, v_uid, 'admin', v_uid);

  insert into public.subscriptions (company_id)
  values (v_company);

  perform private.write_audit(v_company, v_uid, 'company.registered', 'company', v_company,
    jsonb_build_object('name', v_name));

  return v_company;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_my_context: the caller's own role/company/entitlement, derived from
-- trusted tables. The app never trusts client-supplied role or company ids.
-- access: none | disabled | suspended | read_only | full
-- ---------------------------------------------------------------------------
create function public.get_my_context() returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  select jsonb_build_object(
    'user_id', v_uid,
    'is_founder', exists (select 1 from public.founders f where f.user_id = v_uid),
    'company_id', c.id,
    'company_name', c.name,
    'company_status', c.status,
    'role', m.role,
    'member_status', m.status,
    'plan', s.plan,
    'subscription_status', s.status,
    'trial_ends_at', s.trial_ends_at,
    'current_period_end', s.current_period_end,
    'access', case
      when c.id is null then 'none'
      when m.status <> 'active' then 'disabled'
      when c.status <> 'active' then 'suspended'
      when private.company_can_write(c.id) then 'full'
      else 'read_only'
    end
  )
  into v_result
  from (select 1) one
  left join public.company_members m on m.user_id = v_uid
  left join public.companies c on c.id = m.company_id
  left join public.subscriptions s on s.company_id = c.id;

  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- authorize_export: server-side gate for bulk export (M4 export route must
-- call this before streaming rows). Raises 42501 unless the caller is an
-- admin or has can_export on the table, and the company is not suspended.
-- Records the authorization in the audit log. Same error for "no such table"
-- and "not allowed" so table ids cannot be probed.
-- NOTE: RLS cannot distinguish "view" from "export"; anyone with can_view can
-- still page through rows via the API. See docs/m1-implementation-notes.md.
-- ---------------------------------------------------------------------------
create function public.authorize_export(p_table_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid;
begin
  select t.company_id into v_company from public.table_metadata t where t.id = p_table_id;

  if v_uid is null
     or v_company is null
     or not private.company_can_read(v_company)
     or not (private.is_company_admin(v_company) or private.has_table_permission(p_table_id, 'export'))
  then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  perform private.write_audit(v_company, v_uid, 'data.export_authorized', 'table', p_table_id, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Founder operations (callable by any authenticated user; the founder check
-- is inside, so non-founders get 42501).
-- ---------------------------------------------------------------------------
create function public.founder_set_company_status(p_company uuid, p_status text, p_reason text default null)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_founder() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_status not in ('active', 'suspended') then
    raise exception 'invalid status' using errcode = '22023';
  end if;

  update public.companies set status = p_status where id = p_company;
  if not found then
    raise exception 'company not found' using errcode = 'P0002';
  end if;

  perform private.write_audit(p_company, v_uid, 'company.status_changed', 'company', p_company,
    jsonb_build_object('status', p_status, 'reason', left(coalesce(p_reason, ''), 500)));
end;
$$;

create function public.founder_set_subscription(
  p_company uuid, p_plan text, p_status text,
  p_trial_ends_at timestamptz default null, p_current_period_end timestamptz default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_founder() then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  update public.subscriptions
     set plan = p_plan,
         status = p_status,
         trial_ends_at = coalesce(p_trial_ends_at, trial_ends_at),
         current_period_end = p_current_period_end
   where company_id = p_company;
  if not found then
    raise exception 'subscription not found' using errcode = 'P0002';
  end if;

  perform private.write_audit(p_company, v_uid, 'subscription.updated', 'company', p_company,
    jsonb_build_object('plan', p_plan, 'status', p_status,
                       'trial_ends_at', p_trial_ends_at, 'current_period_end', p_current_period_end));
end;
$$;

-- ---------------------------------------------------------------------------
-- Operator-only founder provisioning (private schema, never API-exposed).
-- Requires the auth user to already exist and be email-confirmed, and refuses
-- accounts that belong to a company (no mixed founder/customer identities).
-- ---------------------------------------------------------------------------
create function private.grant_founder(p_email text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select u.id into v_user
  from auth.users u
  where lower(u.email) = lower(btrim(p_email)) and u.email_confirmed_at is not null;

  if v_user is null then
    raise exception 'no confirmed auth user with that email' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.company_members m where m.user_id = v_user) then
    raise exception 'user belongs to a company' using errcode = '23505';
  end if;

  insert into public.founders (user_id) values (v_user) on conflict do nothing;
  perform private.write_audit(null, null, 'founder.granted', 'user', v_user, '{}'::jsonb);
end;
$$;

create function private.revoke_founder(p_email text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  delete from public.founders where user_id = v_user;
  perform private.write_audit(null, null, 'founder.revoked', 'user', v_user, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute privileges (functions default to EXECUTE for PUBLIC — remove it).
-- ---------------------------------------------------------------------------
revoke all on function public.register_company(text) from public, anon;
revoke all on function public.get_my_context() from public, anon;
revoke all on function public.authorize_export(uuid) from public, anon;
revoke all on function public.founder_set_company_status(uuid, text, text) from public, anon;
revoke all on function public.founder_set_subscription(uuid, text, text, timestamptz, timestamptz) from public, anon;
revoke all on function private.grant_founder(text) from public, anon, authenticated, service_role;
revoke all on function private.revoke_founder(text) from public, anon, authenticated, service_role;

grant execute on function public.register_company(text) to authenticated;
grant execute on function public.get_my_context() to authenticated;
grant execute on function public.authorize_export(uuid) to authenticated;
grant execute on function public.founder_set_company_status(uuid, text, text) to authenticated;
grant execute on function public.founder_set_subscription(uuid, text, text, timestamptz, timestamptz) to authenticated;
