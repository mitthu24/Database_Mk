-- Manual payments, payment-gated activation, platform settings.

-- ---- submission ---------------------------------------------------------------------
select test.login(test.id('adminA'));
select test.keep('p1', public.submit_manual_payment(100.50, 'usd', 3, 'Bank transfer', 'REF-1001', 'paid 3 Nov'));
select test.ok(test.got('p1') ->> 'status' = 'pending' and test.got('p1') ->> 'currency' = 'USD'
               and (test.got('p1') ->> 'amount')::numeric = 100.50, 'a submitted payment is pending, currency normalized');
select test.throws($$select public.submit_manual_payment(100, 'USD', 1, 'Bank', ' ref-1001 ', null)$$, '23505', 'the same transfer reference cannot be submitted twice (case/space-insensitive)');
select test.throws($$select public.submit_manual_payment(0, 'USD', 1, 'Bank', 'REF-X1', null)$$, '23514', 'zero amount rejected');
select test.throws($$select public.submit_manual_payment(-5, 'USD', 1, 'Bank', 'REF-X2', null)$$, '23514', 'negative amount rejected');
select test.throws($$select public.submit_manual_payment(5, 'US', 1, 'Bank', 'REF-X3', null)$$, '23514', 'invalid currency rejected');
select test.throws($$select public.submit_manual_payment(5, 'USD', 0, 'Bank', 'REF-X4', null)$$, '23514', 'zero months rejected');
select test.throws($$select public.submit_manual_payment(5, 'USD', 37, 'Bank', 'REF-X5', null)$$, '23514', 'more than 36 months rejected');
select test.throws($$select public.submit_manual_payment(5, 'USD', 1, 'Bank', 'ab', null)$$, '23514', 'too-short reference rejected');
select test.throws($$select public.submit_manual_payment(5, 'USD', 1, '  ', 'REF-X6', null)$$, '23514', 'blank method rejected');
select test.ok(jsonb_array_length(public.list_payments()) = 2, 'the admin sees the company''s payments (history includes the earlier approved one)');
select test.logout();

select test.login(test.id('editorA'));
select test.throws($$select public.submit_manual_payment(5, 'USD', 1, 'Bank', 'REF-E1', null)$$, '42501', 'employees cannot submit payments');
select test.ok(jsonb_array_length(public.list_payments()) = 0, 'employees cannot see payments');
select test.logout();

select test.login(test.id('adminB'));
select test.ok(jsonb_array_length(public.list_payments()) = 0, 'company B cannot see company A''s payments');
select test.keep('pb1', public.submit_manual_payment(40, 'EUR', 1, 'Bank transfer', 'REF-B-1', null));
select test.logout();
select test.login(test.id('adminA'));
select test.ok(jsonb_array_length(public.list_payments()) = 2, 'company A cannot see company B''s payment');

-- pending limit (anti-spam): 1 pending now, allow up to 5
select public.submit_manual_payment(1, 'USD', 1, 'Bank', 'REF-100' || g, null) from generate_series(2, 5) g;
select test.throws($$select public.submit_manual_payment(1, 'USD', 1, 'Bank', 'REF-1006', null)$$, '53400', 'at most 5 pending payments per company');
select test.logout();

-- ---- founder review ---------------------------------------------------------------------
select test.login(test.id('adminA'));
select test.throws($$select public.founder_list_payments()$$, '42501', 'a company admin cannot list all payments');
select test.throws($$select public.founder_review_payment(test.id('adminA'), 'approve')$$, '42501', 'a company admin cannot review payments');
select test.logout();

select test.login(test.id('founder'));
select test.ok((public.founder_list_payments('pending') ->> 'total')::int = 6
               and (public.founder_list_payments('pending') -> 'rows' -> 0 ->> 'company_name') is not null, 'the founder lists pending payments across companies, with company names');
select test.throws($$select public.founder_review_payment((test.got('p1') ->> 'id')::uuid, 'maybe')$$, '22023', 'unknown decision rejected');
select test.throws($$select public.founder_review_payment((test.got('p1') ->> 'id')::uuid, 'reject')$$, '22023', 'rejection requires a reason');
select test.throws($$select public.founder_review_payment(gen_random_uuid(), 'approve')$$, 'P0002', 'unknown payment');

-- approve A (trialing, ~30 days left): the paid period starts AFTER the remaining trial
select test.keep('trial_end_a', to_jsonb((select trial_ends_at from public.subscriptions where company_id = test.id('companyA'))));
select public.founder_review_payment((test.got('p1') ->> 'id')::uuid, 'approve', 'received');
select test.ok((select status = 'active' and plan = 'standard' from public.subscriptions where company_id = test.id('companyA')), 'approval activates the subscription');
select test.ok((select current_period_end between (trial_ends_at + interval '3 months' - interval '1 minute') and (trial_ends_at + interval '3 months' + interval '1 minute')
                from public.subscriptions where company_id = test.id('companyA')),
  'approval extends from the end of the remaining trial by the paid months (no days wasted)');
select test.ok((select status = 'approved' and reviewed_at is not null and review_note = 'received' from public.manual_payments where id = (test.got('p1') ->> 'id')::uuid), 'the payment records its review');
select test.throws($$select public.founder_review_payment((test.got('p1') ->> 'id')::uuid, 'approve')$$, '23514', 'a payment cannot be reviewed twice');
select test.ok(exists (select 1 from public.audit_logs where action = 'payment.approved' and target_id = (test.got('p1') ->> 'id')::uuid), 'approval is audited');

-- reject: subscription untouched
select test.keep('end_before', to_jsonb((select current_period_end from public.subscriptions where company_id = test.id('companyA'))));
select public.founder_review_payment((select id from public.manual_payments where reference = 'REF-1002'), 'reject', 'amount does not match');
select test.ok((select status = 'rejected' and review_note = 'amount does not match' from public.manual_payments where reference = 'REF-1002')
               and (select to_jsonb(current_period_end) from public.subscriptions where company_id = test.id('companyA')) = test.got('end_before'),
  'a rejected payment records the reason and changes nothing else');

-- renewal while active: extends from the CURRENT period end
select public.founder_review_payment((select id from public.manual_payments where reference = 'REF-1003'), 'approve', null);   -- 1 month
select test.ok((select current_period_end from public.subscriptions where company_id = test.id('companyA'))
               between ((select (test.got('end_before') #>> '{}')::timestamptz) + interval '1 month' - interval '1 minute')
                   and ((select (test.got('end_before') #>> '{}')::timestamptz) + interval '1 month' + interval '1 minute'),
  'renewing while active extends from the current period end');
select test.logout();

-- the founder still cannot bypass payments
select test.login(test.id('founder'));
select test.throws($$select public.founder_set_subscription(test.id('companyB'), 'standard', 'active', null, now() + interval '30 days')$$, '22023', 'no direct activation, ever');
select test.logout();

-- ---- expired company can pay and reactivate; suspended cannot --------------------------------
update public.subscriptions set trial_started_at = now() - interval '40 days', trial_ends_at = now() - interval '10 days' where company_id = test.id('companyB');
select test.login(test.id('adminB'));
select test.ok(public.get_my_context() ->> 'access' = 'read_only', 'company B is trial-expired (read-only)');
select test.throws($$insert into public.data_rows (company_id, table_id, data) values (test.id('companyB'), test.id('ordersB'), '{"sku":"X"}')$$, '42501', 'expired: writes rejected');
select test.keep('pb2', public.submit_manual_payment(40, 'EUR', 1, 'Bank transfer', 'REF-B-2', null));
select test.ok(test.got('pb2') ->> 'status' = 'pending', 'an expired company can still submit a payment to reactivate');
select test.logout();

select test.login(test.id('founder'));
select public.founder_review_payment((test.got('pb2') ->> 'id')::uuid, 'approve', null);
select test.logout();
select test.login(test.id('adminB'));
select test.ok(public.get_my_context() ->> 'access' = 'full' and public.get_my_context() ->> 'subscription_status' = 'active', 'approval of a payment reactivates an expired company');
select test.ok(test.affected($$insert into public.data_rows (company_id, table_id, data) values (test.id('companyB'), test.id('ordersB'), '{"sku":"AFTER-PAY"}')$$) = 1, 'writes work again');
select test.logout();

select test.login(test.id('founder'));
select public.founder_set_company_status(test.id('companyB'), 'suspended', 'payment test');
select test.logout();
select test.login(test.id('adminB'));
select test.throws($$select public.submit_manual_payment(1, 'EUR', 1, 'Bank', 'REF-B-3', null)$$, '42501', 'a suspended company cannot submit payments');
select test.logout();
select test.login(test.id('founder'));
select public.founder_review_payment((test.got('pb1') ->> 'id')::uuid, 'approve', null);   -- pending from before the suspension
select test.ok(test.company_state(test.id('companyB')) = 'suspended', 'approving a payment never lifts a suspension');
select public.founder_set_company_status(test.id('companyB'), 'active', 'done');
select public.founder_set_subscription(test.id('companyB'), 'standard', 'canceled', null, null);
select test.ok(test.company_state(test.id('companyB')) = 'read_only', 'a canceled subscription is read-only');
select test.logout();

-- ---- platform settings -----------------------------------------------------------------------
select test.login(test.id('founder'));
select public.founder_update_setting('payment_instructions', 'Transfer to the account shown on your invoice and quote the reference.');
select public.founder_update_setting('support_email', 'support@example.test');
select test.throws($$select public.founder_update_setting('secret_thing', 'x')$$, '22023', 'unknown setting rejected');
select test.throws($$select public.founder_update_setting('payment_instructions', repeat('x', 4001))$$, '23514', 'oversized setting rejected');
select test.logout();
select test.login(test.id('editorA'));
select test.ok(public.get_platform_settings() ->> 'support_email' = 'support@example.test', 'any signed-in user can read the payment/support settings');
select test.throws($$select public.founder_update_setting('support_email', 'evil@example.test')$$, '42501', 'only the founder can change settings');
select test.throws($$update public.platform_settings set value = 'x'$$, '42501', 'no direct writes to settings');
select test.logout();
select test.login(test.id('adminA'));
select test.throws($$select public.founder_update_setting('support_email', 'evil@example.test')$$, '42501', 'a company admin cannot change settings');
select test.logout();
select test.login(test.id('founder'));
select public.founder_update_setting('support_email', '');
select test.ok(not (public.get_platform_settings() ? 'support_email'), 'an empty value removes the setting');
select test.logout();
select test.anon();
select test.throws('select public.get_platform_settings()', '42501', 'anon cannot read settings');
select test.logout();

-- restore the fixture subscriptions for later files
update public.subscriptions
   set status = 'trialing', plan = 'trial', current_period_end = null, trial_started_at = now(), trial_ends_at = now() + interval '30 days'
 where company_id in (test.id('companyA'), test.id('companyB'));
