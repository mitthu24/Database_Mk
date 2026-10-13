begin;

-- M2+ / 06 — manual payments, platform settings, payment-gated activation.
--
-- STATUS: DRAFT — NOT APPLIED to any Supabase project.
--
-- Business rules implemented here (all enforced in the database):
--  * A subscription becomes 'active' ONLY through founder approval of a
--    submitted manual payment. founder_set_subscription can no longer set
--    'active'. There is no fake confirmation path.
--  * Companies can submit payments while trial-expired (read-only) so they can
--    reactivate; suspended companies cannot (they have no company access).
--  * Approval extends from the later of: now, the current paid period end, or
--    the unexpired trial end — so paying early never wastes remaining days.

-- ---------------------------------------------------------------------------
-- platform_settings: founder-managed, authenticated-readable support/payment info
-- ---------------------------------------------------------------------------
create table public.platform_settings (
  key         text primary key,
  value       text not null,
  updated_by  uuid,
  updated_at  timestamptz not null default now(),
  constraint platform_settings_key_valid check (key in ('payment_instructions', 'support_email', 'plan_price_text')),
  constraint platform_settings_value_len check (char_length(value) <= 4000)
);

alter table public.platform_settings enable row level security;
revoke all on public.platform_settings from public, anon, authenticated, service_role;
grant select on public.platform_settings to authenticated;
create policy platform_settings_select on public.platform_settings for select to authenticated using (true);

create function public.get_platform_settings() returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from public.platform_settings
$$;

create function public.founder_update_setting(p_key text, p_value text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or not private.is_founder() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_key not in ('payment_instructions', 'support_email', 'plan_price_text') then
    raise exception 'unknown setting' using errcode = '22023';
  end if;
  if coalesce(btrim(p_value), '') = '' then
    delete from public.platform_settings where key = p_key;
  else
    insert into public.platform_settings (key, value, updated_by) values (p_key, btrim(p_value), v_uid)
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
  end if;
  perform private.write_audit(null, v_uid, 'settings.updated', 'setting', null, jsonb_build_object('key', p_key));
end;
$$;

-- ---------------------------------------------------------------------------
-- manual_payments
-- ---------------------------------------------------------------------------
create table public.manual_payments (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  submitted_by  uuid,
  amount        numeric(12, 2) not null,
  currency      text not null,
  months        integer not null,
  method        text not null,
  reference     text not null,
  note          text,
  status        text not null default 'pending',
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  review_note   text,
  created_at    timestamptz not null default now(),
  constraint manual_payments_amount_range check (amount > 0 and amount < 100000000),
  constraint manual_payments_currency_fmt check (currency ~ '^[A-Z]{3}$'),
  constraint manual_payments_months_range check (months between 1 and 36),
  constraint manual_payments_method_len check (char_length(btrim(method)) between 1 and 60),
  constraint manual_payments_reference_len check (char_length(btrim(reference)) between 3 and 200),
  constraint manual_payments_note_len check (note is null or char_length(note) <= 1000),
  constraint manual_payments_review_note_len check (review_note is null or char_length(review_note) <= 1000),
  constraint manual_payments_status_valid check (status in ('pending', 'approved', 'rejected')),
  constraint manual_payments_review_consistent check ((status = 'pending') = (reviewed_at is null))
);
-- the same bank/transfer reference cannot be submitted twice by a company
create unique index manual_payments_company_reference_key
  on public.manual_payments (company_id, lower(btrim(reference)));
create index manual_payments_company_created_idx on public.manual_payments (company_id, created_at desc);
create index manual_payments_status_created_idx on public.manual_payments (status, created_at desc);

alter table public.manual_payments enable row level security;
revoke all on public.manual_payments from public, anon, authenticated, service_role;
grant select on public.manual_payments to authenticated;
create policy manual_payments_select on public.manual_payments
  for select to authenticated
  using (private.is_company_admin(company_id) or private.is_founder());

create function private.payment_json(p public.manual_payments) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'company_id', p.company_id, 'amount', p.amount, 'currency', p.currency,
    'months', p.months, 'method', p.method, 'reference', p.reference, 'note', p.note,
    'status', p.status, 'review_note', p.review_note, 'reviewed_at', p.reviewed_at,
    'created_at', p.created_at)
$$;

create function public.submit_manual_payment(
  p_amount numeric, p_currency text, p_months integer, p_method text, p_reference text, p_note text default null
) returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_company uuid := private.my_admin_company();
  p public.manual_payments;
begin
  if v_uid is null or v_company is null or not private.company_can_read(v_company) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if (select count(*) from public.manual_payments where company_id = v_company and status = 'pending') >= 5 then
    raise exception 'too many pending payments; wait for review' using errcode = '53400';
  end if;

  insert into public.manual_payments (company_id, submitted_by, amount, currency, months, method, reference, note)
  values (v_company, v_uid, p_amount, upper(btrim(p_currency)), p_months, btrim(p_method), btrim(p_reference),
          nullif(btrim(coalesce(p_note, '')), ''))
  returning * into p;

  perform private.write_audit(v_company, v_uid, 'payment.submitted', 'payment', p.id,
    jsonb_build_object('amount', p.amount, 'currency', p.currency, 'months', p.months));
  return private.payment_json(p);
end;
$$;

create function public.list_payments() returns jsonb
language sql stable security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(private.payment_json(p) order by p.created_at desc), '[]'::jsonb)
  from public.manual_payments p
$$;

-- ---------------------------------------------------------------------------
-- founder payment review. Approval is the ONLY way a subscription becomes active.
-- ---------------------------------------------------------------------------
create function public.founder_review_payment(p_payment uuid, p_decision text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pay public.manual_payments;
  v_base timestamptz;
  v_end timestamptz;
begin
  if v_uid is null or not private.is_founder() then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_decision not in ('approve', 'reject') then
    raise exception 'decision must be approve or reject' using errcode = '22023';
  end if;

  select * into pay from public.manual_payments where id = p_payment for update;
  if not found then
    raise exception 'payment not found' using errcode = 'P0002';
  end if;
  if pay.status <> 'pending' then
    raise exception 'payment was already reviewed' using errcode = '23514';
  end if;
  if p_decision = 'reject' and coalesce(btrim(p_note), '') = '' then
    raise exception 'a reason is required to reject a payment' using errcode = '22023';
  end if;

  if p_decision = 'approve' then
    select greatest(
             now(),
             coalesce(s.current_period_end, '-infinity'::timestamptz),
             case when s.status = 'trialing' then s.trial_ends_at else '-infinity'::timestamptz end)
      into v_base
    from public.subscriptions s where s.company_id = pay.company_id for update;
    if v_base is null then
      raise exception 'company has no subscription' using errcode = 'P0002';
    end if;
    v_end := v_base + make_interval(months => pay.months);
    update public.subscriptions
       set status = 'active', plan = 'standard', current_period_end = v_end
     where company_id = pay.company_id;
  end if;

  update public.manual_payments
     set status = case p_decision when 'approve' then 'approved' else 'rejected' end,
         reviewed_by = v_uid, reviewed_at = now(), review_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_payment
   returning * into pay;

  perform private.write_audit(pay.company_id, v_uid, 'payment.' || pay.status, 'payment', pay.id,
    jsonb_build_object('amount', pay.amount, 'currency', pay.currency, 'months', pay.months,
                       'period_end', v_end));
  return private.payment_json(pay);
end;
$$;

-- founder_set_subscription (M1) may no longer activate a subscription.
create or replace function public.founder_set_subscription(
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
  if p_status = 'active' then
    raise exception 'a subscription can only become active through an approved payment' using errcode = '22023';
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
-- Execute privileges
-- ---------------------------------------------------------------------------
revoke all on function private.payment_json(public.manual_payments) from public, anon, authenticated;
grant execute on function private.payment_json(public.manual_payments) to authenticated;

revoke all on function public.get_platform_settings(), public.founder_update_setting(text, text),
  public.submit_manual_payment(numeric, text, integer, text, text, text), public.list_payments(),
  public.founder_review_payment(uuid, text, text)
  from public, anon;
grant execute on function public.get_platform_settings(), public.founder_update_setting(text, text),
  public.submit_manual_payment(numeric, text, integer, text, text, text), public.list_payments(),
  public.founder_review_payment(uuid, text, text)
  to authenticated;

commit;
