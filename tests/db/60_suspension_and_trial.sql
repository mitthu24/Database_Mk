-- Suspended companies and trial expiry.
--
-- Defined behaviour (documented in docs/m1-implementation-notes.md):
--   suspended      => no data access for anyone in the company; the company and
--                     subscription rows stay visible so the UI can explain why.
--   trial expired  => READ-ONLY: admins and permitted employees can still read
--                     and pass the export gate; every write is rejected.

create function test.company_state(p_company uuid) returns text language sql stable security definer set search_path = '' as $$
  select private.company_access(p_company)
$$;
grant execute on function test.company_state(uuid) to public;

-- ---- Suspension --------------------------------------------------------------
select test.login(test.id('adminA'));
select test.throws($$select public.founder_set_company_status(test.id('companyA'), 'suspended')$$, '42501',
  'a company admin cannot suspend or un-suspend a company (RPC)');
select test.logout();

select test.login(test.id('founder'));
select test.throws($$select public.founder_set_company_status(test.id('companyA'), 'banana')$$, '22023', 'invalid status rejected');
select public.founder_set_company_status(test.id('companyA'), 'suspended', 'test suspension');
select test.logout();

select test.ok(exists (select 1 from public.audit_logs where action = 'company.status_changed'
                       and company_id = test.id('companyA') and metadata ->> 'status' = 'suspended'),
  'suspension is audited with its reason');

select test.login(test.id('adminA'));
select test.ok(test.count('select 1 from public.data_rows') = 0, 'suspended: admin cannot read data rows');
select test.ok(test.count('select 1 from public.table_metadata') = 0, 'suspended: admin cannot read table definitions');
select test.throws($$insert into public.data_rows (company_id, table_id, data)
                     values (test.id('companyA'), test.id('ordersA'), '{"x":1}')$$, '42501',
  'suspended: admin cannot insert data');
select test.throws($$insert into public.table_metadata (company_id, name) values (test.id('companyA'), 'Late')$$, '42501',
  'suspended: admin cannot create tables');
select test.throws($$select public.authorize_export(test.id('ordersA'))$$, '42501', 'suspended: export gate refuses admin');
select test.ok(test.affected($$update public.companies set name = 'Rename While Suspended' where id = test.id('companyA')$$) = 0,
  'suspended: admin cannot even rename the company');
select test.ok(test.count($$select 1 from public.companies where status = 'suspended'$$) = 1,
  'suspended: the company row stays visible so the app can explain the state');
select test.ok(public.get_my_context() ->> 'access' = 'suspended', 'get_my_context reports suspended');
select test.logout();

select test.login(test.id('viewerA'));
select test.ok(test.count('select 1 from public.data_rows') = 0, 'suspended: employee cannot read data rows');
select test.ok(public.get_my_context() ->> 'access' = 'suspended', 'get_my_context reports suspended for employees');
select test.logout();

-- Company B is unaffected.
select test.login(test.id('adminB'));
select test.ok(test.count('select 1 from public.data_rows') = 2, 'suspending company A does not affect company B');
select test.logout();

select test.login(test.id('founder'));
select public.founder_set_company_status(test.id('companyA'), 'active', 'restored');
select test.logout();
select test.login(test.id('adminA'));
select test.ok(test.count('select 1 from public.data_rows') > 0, 'restored: admin can read data again');
select test.ok(public.get_my_context() ->> 'access' = 'full', 'restored: access is full again');
select test.logout();

-- ---- Trial in progress -------------------------------------------------------
select test.login(test.id('adminA'));
select test.ok(public.get_my_context() ->> 'subscription_status' = 'trialing'
               and public.get_my_context() ->> 'access' = 'full',
  'active trial: full access');
select test.logout();

-- ---- Trial expiry (simulate time passing by moving the dates back) ------------
update public.subscriptions
   set trial_started_at = now() - interval '31 days',
       trial_ends_at    = now() - interval '1 day'
 where company_id = test.id('companyA');

select test.login(test.id('adminA'));
select test.ok(public.get_my_context() ->> 'access' = 'read_only', 'expired trial: access becomes read_only');
select test.ok(test.count('select 1 from public.data_rows') > 0, 'expired trial: admin can still read data');
select test.ok(test.count('select 1 from public.table_metadata') = 2, 'expired trial: admin can still see tables');
select test.ok(test.count($$select public.authorize_export(test.id('ordersA'))$$) = 1,
  'expired trial: admin can still export (data portability)');
select test.throws($$insert into public.data_rows (company_id, table_id, data)
                     values (test.id('companyA'), test.id('ordersA'), '{"x":1}')$$, '42501', 'expired trial: insert rejected');
select test.ok(test.affected($$update public.data_rows set data = '{"x":2}' where table_id = test.id('ordersA')$$) = 0,
  'expired trial: update rejected');
select test.ok(test.affected($$delete from public.data_rows where table_id = test.id('ordersA')$$) = 0,
  'expired trial: delete rejected');
select test.throws($$insert into public.table_metadata (company_id, name) values (test.id('companyA'), 'AfterTrial')$$, '42501',
  'expired trial: creating tables rejected');
select test.ok(test.affected($$delete from public.table_metadata where id = test.id('vendorsA')$$) = 0,
  'expired trial: deleting tables rejected');
select test.throws($$insert into public.data_permissions (company_id, user_id, table_id, can_view)
                     values (test.id('companyA'), test.id('nograntA'), test.id('vendorsA'), true)$$, '42501',
  'expired trial: changing permissions rejected');
select test.throws($$update public.subscriptions set trial_ends_at = now() + interval '30 days'$$, '42501',
  'expired trial: admin cannot extend the trial themselves');
select test.logout();

select test.login(test.id('viewerA'));
select test.ok(test.count($$select 1 from public.data_rows where table_id = test.id('ordersA')$$) > 0,
  'expired trial: permitted employee can still read');
select test.logout();

-- Company B (still trialing) is unaffected.
select test.login(test.id('adminB'));
select test.ok(public.get_my_context() ->> 'access' = 'full', 'company B trial unaffected by company A expiry');
select test.logout();

-- A subscription can only become active through an APPROVED payment.
select test.login(test.id('founder'));
select test.throws($$select public.founder_set_subscription(test.id('companyA'), 'standard', 'active', null, now() + interval '30 days')$$, '22023',
  'the founder cannot activate a subscription directly (no payment, no activation)');
select test.logout();
select test.ok(test.company_state(test.id('companyA')) = 'read_only', 'still read-only after the refused direct activation');

select test.login(test.id('adminA'));
select test.keep('pay60', public.submit_manual_payment(50, 'usd', 1, 'Bank transfer', 'T60-0001', null));
select test.logout();
select test.login(test.id('founder'));
select public.founder_review_payment((test.got('pay60') ->> 'id')::uuid, 'approve', null);
select test.logout();
select test.login(test.id('adminA'));
select test.ok(public.get_my_context() ->> 'access' = 'full', 'approved payment: access is full again');
select test.ok(test.affected($$insert into public.data_rows (company_id, table_id, data)
                               values (test.id('companyA'), test.id('ordersA'), '{"sku":"PAID"}')$$) = 1,
  'approved payment: writes allowed again');
select test.logout();

-- Paid period lapses => read-only again.
update public.subscriptions set current_period_end = now() - interval '1 hour' where company_id = test.id('companyA');
select test.login(test.id('adminA'));
select test.ok(public.get_my_context() ->> 'access' = 'read_only', 'lapsed paid period: read_only');
select test.logout();

-- Restore for any later file.
update public.subscriptions
   set status = 'trialing', plan = 'trial', current_period_end = null,
       trial_started_at = now(), trial_ends_at = now() + interval '30 days'
 where company_id = test.id('companyA');
