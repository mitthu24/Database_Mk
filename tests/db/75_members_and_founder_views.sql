-- Company profile, member + permission management, audit viewer, founder views.

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('e0000000-0000-0000-0000-000000000001', 'invitee1@test.local', '{"full_name":"Ivy Invitee"}', now()),
  ('e0000000-0000-0000-0000-000000000002', 'newadmin@test.local',  '{"full_name":"Nia NewAdmin"}', now()),
  ('e0000000-0000-0000-0000-000000000003', 'invitee3@test.local', '{"full_name":"Ian Invitee"}', now());
insert into test.ids (name, id) values
  ('invitee1', 'e0000000-0000-0000-0000-000000000001'),
  ('newadmin', 'e0000000-0000-0000-0000-000000000002'),
  ('invitee3', 'e0000000-0000-0000-0000-000000000003');

-- ---- company profile ----------------------------------------------------------------------
select test.login(test.id('adminA'));
select test.ok(public.get_company_profile() ->> 'name' = 'Acme Plywood Ltd', 'the admin reads the company profile');
select test.ok(public.update_company_profile('Acme Plywood Ltd', 'ops@acme.test', '+1 555 0100', '1 Mill Road') ->> 'contact_email' = 'ops@acme.test', 'the admin updates the company profile');
select test.throws($$select public.update_company_profile('A', null, null, null)$$, '22023', 'short company name rejected');
select test.throws($$select public.update_company_profile('Acme', 'not-an-email', null, null)$$, '22023', 'invalid contact email rejected');
select test.ok(exists (select 1 from public.audit_logs where action = 'company.profile_updated' and company_id = test.id('companyA')), 'profile edits are audited');
select test.logout();
select test.login(test.id('editorA'));
select test.ok(public.get_company_profile() ->> 'name' = 'Acme Plywood Ltd', 'an employee can read the company profile');
select test.throws($$select public.update_company_profile('Hacked', null, null, null)$$, '42501', 'an employee cannot edit it');
select public.update_my_profile('Edie E.');
select test.ok((select full_name from public.profiles where id = test.id('editorA')) = 'Edie E.', 'a user can update their own display name');
select test.throws($$select public.update_my_profile('')$$, '22023', 'blank display name rejected');
select test.logout();
select test.login(test.id('adminB'));
select test.ok(public.get_company_profile() ->> 'name' = 'Birch Veneer', 'company B reads only its own profile');
select test.logout();

-- ---- members ------------------------------------------------------------------------------------
select test.login(test.id('adminA'));
select test.ok(jsonb_array_length(public.list_members()) = 5, 'the admin lists every member of their company (admin + 4 employees)');
select test.keep('m_invitee1', public.add_company_member(test.id('invitee1'), null));
select test.ok(test.got('m_invitee1') ->> 'employee_code' = 'EMP-0005' and test.got('m_invitee1') ->> 'role' = 'employee'
               and test.got('m_invitee1') ->> 'email' = 'invitee1@test.local', 'a new member gets a generated employee code and the employee role');
select test.keep('m_invitee3', public.add_company_member(test.id('invitee3'), 'CUSTOM-9'));
select test.ok(test.got('m_invitee3') ->> 'employee_code' = 'CUSTOM-9', 'an explicit employee code is honoured');
select test.throws($$select public.add_company_member(test.id('invitee1'), null)$$, '23505', 'a user cannot be added twice');
select test.throws($$select public.add_company_member(test.id('adminB'), null)$$, '23505', 'a member of another company cannot be added');
select test.throws($$select public.add_company_member(test.id('founder'), null)$$, '23505', 'a founder can never be added to a company');
select test.throws($$select public.add_company_member(gen_random_uuid(), null)$$, 'P0002', 'unknown user');
select test.ok(exists (select 1 from public.audit_logs where action = 'member.added' and target_id = test.id('invitee1')), 'adding a member is audited');
select test.logout();

select test.login(test.id('editorA'));
select test.throws($$select public.add_company_member(test.id('plain'), null)$$, '42501', 'an employee cannot add members');
select test.ok(jsonb_array_length(public.list_members()) = 1, 'an employee sees only themselves in the member list');
select test.logout();

select test.login(test.id('adminB'));
select test.throws($$select public.set_member_status((test.got('m_invitee1') ->> 'id')::uuid, 'disabled')$$, '42501', 'admin B cannot change company A''s members');
select test.throws($$select public.set_member_role((test.got('m_invitee1') ->> 'id')::uuid, 'admin')$$, '42501', 'admin B cannot promote company A''s members');
select test.throws($$select public.set_member_code((test.got('m_invitee1') ->> 'id')::uuid, 'HACK')$$, '42501', 'admin B cannot re-code company A''s members');
select test.logout();

select test.login(test.id('adminA'));
select test.ok(public.set_member_status((test.got('m_invitee1') ->> 'id')::uuid, 'disabled') ->> 'status' = 'disabled', 'a member can be disabled');
select test.throws($$select public.set_member_status((select id from public.company_members where user_id = auth.uid()), 'disabled')$$, '23514', 'an admin cannot disable themselves');
select test.throws($$select public.set_member_status((test.got('m_invitee1') ->> 'id')::uuid, 'banana')$$, '22023', 'invalid status rejected');
select test.ok(public.set_member_status((test.got('m_invitee1') ->> 'id')::uuid, 'active') ->> 'status' = 'active', 'a member can be re-enabled');
select test.ok(public.set_member_code((test.got('m_invitee1') ->> 'id')::uuid, 'EMP-777') ->> 'employee_code' = 'EMP-777', 'an employee code can be changed');
select test.throws($$select public.set_member_code((test.got('m_invitee3') ->> 'id')::uuid, 'emp-777')$$, '23505', 'employee codes are unique per company (case-insensitive)');
select test.throws($$select public.set_member_role((test.got('m_invitee1') ->> 'id')::uuid, 'founder')$$, '22023', 'the founder role can never be assigned');
select test.throws($$select public.set_member_role((test.got('m_invitee1') ->> 'id')::uuid, 'owner')$$, '22023', 'unknown roles rejected');
select test.throws($$select public.set_member_role((select id from public.company_members where user_id = auth.uid()), 'employee')$$, '23514', 'an admin cannot change their own role');
select test.ok(public.set_member_role((test.got('m_invitee1') ->> 'id')::uuid, 'admin') ->> 'role' = 'admin', 'an employee can be promoted to company admin');
select test.logout();
select test.login(test.id('invitee1'));
select test.ok(public.get_my_context() ->> 'role' = 'admin' and not (public.get_my_context() ->> 'is_founder')::boolean, 'the promoted user is a company admin, not a founder');
select test.ok(jsonb_array_length(public.list_members()) >= 6, 'the promoted admin sees the whole team');
select test.logout();
select test.login(test.id('adminA'));
select public.set_member_role((test.got('m_invitee1') ->> 'id')::uuid, 'employee');
select public.set_member_status((test.got('m_invitee1') ->> 'id')::uuid, 'disabled');
select test.logout();
select test.login(test.id('invitee1'));
select test.ok(public.get_my_context() ->> 'access' = 'disabled', 'a disabled member has no access');
select test.logout();

-- ---- table permissions -----------------------------------------------------------------------------
select test.login(test.id('adminA'));
select public.set_table_permission(test.id('editorA'), test.id('vendorsA'), false, false, true, false, false, false);   -- edit => implies view
select test.ok(exists (select 1 from jsonb_array_elements(public.list_permissions(test.id('editorA'))) p
                       where p ->> 'table_name' = 'Vendors' and (p ->> 'can_view')::boolean and (p ->> 'can_edit')::boolean),
  'any operation implies view access');
select test.ok(jsonb_array_length(public.list_permissions()) >= 4, 'the admin lists permissions across employees');
select public.set_table_permission(test.id('editorA'), test.id('vendorsA'), false, false, false, false, false, false);
select test.ok(not exists (select 1 from public.data_permissions where user_id = test.id('editorA') and table_id = test.id('vendorsA')), 'revoking every operation removes the grant');
select test.throws($$select public.set_table_permission(test.id('adminA'), test.id('vendorsA'), true, true, true, true, true, true)$$, '42501', 'permissions are for employees, not admins');
select test.throws($$select public.set_table_permission(test.id('empB'), test.id('vendorsA'), true, false, false, false, false, false)$$, '42501', 'cannot grant to a user of another company');
select test.throws($$select public.set_table_permission(test.id('editorA'), test.id('ordersB'), true, false, false, false, false, false)$$, '42501', 'cannot grant on another company''s table');
select test.logout();
select test.login(test.id('editorA'));
select test.throws($$select public.set_table_permission(test.id('editorA'), test.id('vendorsA'), true, true, true, true, true, true)$$, '42501', 'an employee cannot grant themselves anything');
select test.ok(jsonb_array_length(public.list_permissions()) = 1 and public.list_permissions() -> 0 ->> 'table_name' = 'Orders', 'an employee sees only their own grants');
select test.logout();

-- ---- company audit viewer --------------------------------------------------------------------------------
select test.login(test.id('adminA'));
select test.ok((public.list_company_audit() ->> 'total')::int > 5 and public.list_company_audit() -> 'rows' -> 0 ? 'actor_email', 'the admin reads the company audit log with actor emails');
select test.ok((public.list_company_audit('member.') ->> 'total')::int >= 4 and not exists (
    select 1 from jsonb_array_elements(public.list_company_audit('member.') -> 'rows') r where r ->> 'action' not like 'member.%'), 'audit filtering by action prefix');
select test.ok(jsonb_array_length(public.list_company_audit(null, 3, 0) -> 'rows') = 3, 'audit pagination');
select test.ok(not exists (select 1 from jsonb_array_elements(public.list_company_audit(null, 200, 0) -> 'rows') r where r ->> 'action' = 'company.registered' and (r ->> 'target_id')::uuid = test.id('companyB')),
  'company A''s audit view never contains company B''s events');
select test.logout();
select test.login(test.id('editorA'));
select test.ok((public.list_company_audit() ->> 'total')::int = 0, 'employees see no audit events');
select test.logout();

-- ---- founder views ---------------------------------------------------------------------------------------------
select test.login(test.id('adminA'));
select test.throws($$select public.founder_overview()$$, '42501', 'a company admin cannot call founder_overview');
select test.throws($$select public.founder_list_companies()$$, '42501', 'a company admin cannot list companies');
select test.throws($$select public.founder_company_detail(test.id('companyB'))$$, '42501', 'a company admin cannot read another company''s detail');
select test.throws($$select public.founder_audit()$$, '42501', 'a company admin cannot read the platform audit log');
select test.throws($$select public.founder_create_company(test.id('newadmin'), 'Sneaky Co')$$, '42501', 'a company admin cannot provision companies');
select test.logout();
select test.anon();
select test.throws('select public.founder_overview()', '42501', 'anon cannot call founder views');
select test.logout();

select test.login(test.id('founder'));
select test.ok((public.founder_overview() ->> 'companies_total')::int >= 2 and jsonb_array_length(public.founder_overview() -> 'signups_by_month') = 6
               and public.founder_overview() ? 'payments_pending' and public.founder_overview() ? 'trials_ending_7d', 'founder_overview carries totals, trials and 6 months of signups');
select test.ok((public.founder_list_companies('acme') ->> 'total')::int = 1 and public.founder_list_companies('acme') -> 'rows' -> 0 ->> 'admin_email' = 'admin.a@test.local', 'company search by name returns the admin email');
select test.ok((public.founder_list_companies('birch') ->> 'total')::int = 1, 'company search is case-insensitive');
select test.ok((public.founder_list_companies('admin.b@') ->> 'total')::int = 1, 'company search also matches the admin email');
select test.ok((public.founder_list_companies(null, 'trialing') ->> 'total')::int >= 2, 'state filter: trialing');
select test.ok((public.founder_list_companies(null, 'suspended') ->> 'total')::int = 0, 'state filter: suspended (none right now)');
select test.ok(jsonb_array_length(public.founder_list_companies(null, 'all', 1, 0) -> 'rows') = 1 and (public.founder_list_companies(null, 'all', 1, 0) ->> 'total')::int >= 2, 'company pagination');
select test.throws($$select public.founder_list_companies(null, 'weird')$$, '22023', 'unknown state filter rejected');
select public.founder_set_company_status(test.id('companyA'), 'suspended', 'view test');
select test.ok((public.founder_list_companies(null, 'suspended') ->> 'total')::int = 1, 'a suspended company appears under the suspended filter');
select public.founder_set_company_status(test.id('companyA'), 'active', 'view test done');
select test.ok(public.founder_company_detail(test.id('companyA')) -> 'subscription' ->> 'status' = 'trialing'
               and (public.founder_company_detail(test.id('companyA')) ->> 'members')::int >= 6, 'company detail includes subscription and counts');
select test.throws($$select public.founder_company_detail(gen_random_uuid())$$, 'P0002', 'unknown company');
select test.ok(jsonb_array_length(public.founder_list_members(test.id('companyA'))) >= 6, 'founder lists a company''s members');
select test.ok((public.founder_audit(test.id('companyA'), 'member.') ->> 'total')::int >= 4, 'founder audit filters by company and action');
select test.ok(not exists (select 1 from jsonb_array_elements(public.founder_audit(test.id('companyA'), null, 200, 0) -> 'rows') r where r ->> 'company_id' <> test.id('companyA')::text), 'founder audit company filter is exact');

-- provisioning a company for a freshly invited auth user
select test.keep('prov', public.founder_create_company(test.id('newadmin'), 'Newly Provisioned Co'));
select test.ok(exists (select 1 from public.company_members where user_id = test.id('newadmin') and role = 'admin' and company_id = (test.got('prov') ->> 'company_id')::uuid)
               and (select trial_ends_at - trial_started_at from public.subscriptions where company_id = (test.got('prov') ->> 'company_id')::uuid) = interval '30 days',
  'founder_create_company creates company + admin membership + 30-day trial atomically');
select test.throws($$select public.founder_create_company(test.id('newadmin'), 'Again Co')$$, '23505', 'the same user cannot administer two companies');
select test.throws($$select public.founder_create_company(test.id('founder'), 'Founder Co')$$, '23505', 'a founder cannot be made a company admin');
select test.throws($$select public.founder_create_company(gen_random_uuid(), 'Ghost Co')$$, 'P0002', 'unknown user');
select test.throws($$select public.founder_create_company(test.id('invitee3'), 'x')$$, '22023', 'short company name rejected');
select test.logout();
select test.login(test.id('newadmin'));
select test.ok(public.get_my_context() ->> 'role' = 'admin' and public.get_my_context() ->> 'access' = 'full', 'the provisioned admin lands in a working trial company');
select test.logout();
select test.ok(exists (select 1 from public.audit_logs where action = 'company.provisioned' and actor_id = test.id('founder')), 'provisioning is audited with the founder as actor');
