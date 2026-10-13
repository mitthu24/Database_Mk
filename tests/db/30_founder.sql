-- Founder role isolation and provisioning.

-- Before provisioning: the founder auth user has no privileges at all.
select test.login(test.id('founder'));
select test.ok(test.count('select 1 from public.companies') = 0, 'un-provisioned user sees no companies');
select test.throws($$select public.founder_set_company_status(test.id('companyA'), 'suspended')$$, '42501',
  'un-provisioned user cannot call founder RPCs');
select test.logout();

-- The founders table is unreachable by every API role.
select test.login(test.id('adminA'));
select test.throws('select 1 from public.founders', '42501', 'authenticated cannot read founders');
select test.throws($$insert into public.founders (user_id) values (auth.uid())$$, '42501',
  'a company admin cannot make themselves a founder (insert)');
select test.throws($$delete from public.founders$$, '42501', 'authenticated cannot delete founders');
select test.throws($$select private.grant_founder('admin.a@test.local')$$, '42501',
  'authenticated cannot execute private.grant_founder');
select test.throws($$select private.write_audit(null, null, 'x', null, null, null)$$, '42501',
  'authenticated cannot execute private.write_audit');
select test.logout();

select test.service();
select test.throws('select 1 from public.founders', '42501', 'service_role cannot read founders either');
select test.throws($$insert into public.founders (user_id) values (gen_random_uuid())$$, '42501',
  'service_role cannot write founders (operator-only via SQL editor)');
select test.logout();

select test.anon();
select test.throws('select 1 from public.founders', '42501', 'anon cannot read founders');
select test.logout();

-- Operator provisioning guards.
select test.throws($$select private.grant_founder('unconfirmed@test.local')$$, 'P0002',
  'cannot grant founder to an unconfirmed email');
select test.throws($$select private.grant_founder('nobody@test.local')$$, 'P0002',
  'cannot grant founder to a non-existent user');
select test.throws($$select private.grant_founder('admin.a@test.local')$$, '23505',
  'cannot grant founder to a user who belongs to a company');

select private.grant_founder('founder@test.local');
select test.ok(exists (select 1 from public.founders where user_id = test.id('founder')),
  'operator can grant founder to a confirmed, company-less auth user');
select test.ok(exists (select 1 from public.audit_logs where action = 'founder.granted' and target_id = test.id('founder')),
  'founder grant is audited');

-- Founder capabilities.
select test.login(test.id('founder'));
select test.ok(test.count('select 1 from public.companies') >= 2, 'founder sees all companies');
select test.ok(test.count('select 1 from public.subscriptions') >= 2, 'founder sees all subscriptions');
select test.ok(test.count('select 1 from public.company_members') >= 7, 'founder sees all memberships');
select test.ok(test.count('select 1 from public.audit_logs') >= 2, 'founder sees platform audit log');
select test.ok(test.count('select 1 from public.table_metadata') = 0, 'founder cannot read customer table definitions');
select test.ok(test.count('select 1 from public.data_rows') = 0, 'founder cannot read customer data rows');
select test.ok(test.count('select 1 from public.data_permissions') = 0, 'founder cannot read data permissions');
select test.throws($$select public.register_company('Founder Co')$$, '42501', 'a founder cannot register a company');
select test.throws($$insert into public.companies (name) values ('Direct')$$, '42501', 'founder cannot insert companies directly either');
select test.throws($$update public.companies set status = 'suspended'$$, '42501',
  'founder uses audited RPCs, not direct column updates');
select test.logout();

-- get_my_context reflects the founder flag from trusted data only.
select test.login(test.id('founder'));
select test.ok((public.get_my_context() ->> 'is_founder')::boolean is true
               and public.get_my_context() ->> 'access' = 'none',
  'get_my_context: founder flag true, no company access');
select test.logout();
select test.login(test.id('adminA'));
select test.ok((public.get_my_context() ->> 'is_founder')::boolean is false
               and public.get_my_context() ->> 'role' = 'admin'
               and public.get_my_context() ->> 'access' = 'full',
  'get_my_context: company admin is not a founder, has full access');
select test.logout();
select test.anon();
select test.throws('select public.get_my_context()', '42501', 'anon cannot call get_my_context');
select test.logout();

-- Revocation.
select private.revoke_founder('founder@test.local');
select test.login(test.id('founder'));
select test.throws($$select public.founder_set_company_status(test.id('companyA'), 'suspended')$$, '42501',
  'revoked founder loses RPC access');
select test.logout();
select private.grant_founder('founder@test.local');
