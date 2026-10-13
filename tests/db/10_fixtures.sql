-- Fixtures: two separate companies (A, B), a founder, and employees with
-- different permissions. Companies are created through register_company() as
-- the real admin users, exactly like production registration.

insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at) values
  ('f0000000-0000-0000-0000-000000000001', 'founder@test.local', '{}', now()),
  -- hostile signup metadata: must NOT grant anything
  ('a0000000-0000-0000-0000-000000000001', 'admin.a@test.local',
     '{"full_name":"Alice Admin","role":"founder","is_founder":true,"company_id":"b0000000-0000-0000-0000-0000000000aa"}', now()),
  ('a0000000-0000-0000-0000-000000000002', 'editor.a@test.local',   '{"full_name":"Edie Editor"}', now()),
  ('a0000000-0000-0000-0000-000000000003', 'viewer.a@test.local',   '{"full_name":"Vic Viewer"}', now()),
  ('a0000000-0000-0000-0000-000000000004', 'nogrant.a@test.local',  '{"full_name":"Nora NoGrant"}', now()),
  ('a0000000-0000-0000-0000-000000000005', 'exporter.a@test.local', '{"full_name":"Xavier Export"}', now()),
  ('b0000000-0000-0000-0000-000000000001', 'admin.b@test.local',    '{"full_name":"Bob Admin"}', now()),
  ('b0000000-0000-0000-0000-000000000002', 'emp.b@test.local',      '{"full_name":"Beth Employee"}', now()),
  ('c0000000-0000-0000-0000-000000000001', 'plain@test.local',      '{}', now()),
  ('c0000000-0000-0000-0000-000000000002', 'unconfirmed@test.local','{}', null);

insert into test.ids (name, id) values
  ('founder',  'f0000000-0000-0000-0000-000000000001'),
  ('adminA',   'a0000000-0000-0000-0000-000000000001'),
  ('editorA',  'a0000000-0000-0000-0000-000000000002'),
  ('viewerA',  'a0000000-0000-0000-0000-000000000003'),
  ('nograntA', 'a0000000-0000-0000-0000-000000000004'),
  ('exporterA','a0000000-0000-0000-0000-000000000005'),
  ('adminB',   'b0000000-0000-0000-0000-000000000001'),
  ('empB',     'b0000000-0000-0000-0000-000000000002'),
  ('plain',    'c0000000-0000-0000-0000-000000000001'),
  ('unconfirmed','c0000000-0000-0000-0000-000000000002');

-- Registration through the real RPC
select test.login(test.id('adminA'));
select public.register_company('Acme Plywood');
select test.logout();

select test.login(test.id('adminB'));
select public.register_company('Birch Veneer');
select test.logout();

insert into test.ids (name, id)
select 'companyA', company_id from public.company_members where user_id = test.id('adminA');
insert into test.ids (name, id)
select 'companyB', company_id from public.company_members where user_id = test.id('adminB');

-- Employees are inserted as the trusted server (service_role path); clients
-- have no INSERT privilege on company_members (asserted in the tests).
insert into public.company_members (company_id, user_id, role, employee_code, created_by) values
  (test.id('companyA'), test.id('editorA'),   'employee', 'EMP-001', test.id('adminA')),
  (test.id('companyA'), test.id('viewerA'),   'employee', 'EMP-002', test.id('adminA')),
  (test.id('companyA'), test.id('nograntA'),  'employee', 'EMP-003', test.id('adminA')),
  (test.id('companyA'), test.id('exporterA'), 'employee', 'EMP-004', test.id('adminA')),
  (test.id('companyB'), test.id('empB'),      'employee', 'EMP-001', test.id('adminB'));

-- Admins create logical tables (same name in both companies is allowed)
select test.login(test.id('adminA'));
insert into public.table_metadata (company_id, name, columns) values
  (test.id('companyA'), 'Orders',  '[{"key":"sku","type":"text"},{"key":"qty","type":"number"}]'),
  (test.id('companyA'), 'Vendors', '[{"key":"name","type":"text"}]');
select test.logout();

select test.login(test.id('adminB'));
insert into public.table_metadata (company_id, name, columns) values
  (test.id('companyB'), 'Orders', '[{"key":"sku","type":"text"}]');
select test.logout();

insert into test.ids (name, id)
select 'ordersA',  id from public.table_metadata where company_id = test.id('companyA') and name = 'Orders';
insert into test.ids (name, id)
select 'vendorsA', id from public.table_metadata where company_id = test.id('companyA') and name = 'Vendors';
insert into test.ids (name, id)
select 'ordersB',  id from public.table_metadata where company_id = test.id('companyB') and name = 'Orders';

-- Admin A grants permissions on Orders:
--   editorA  : view + create + edit        viewerA : view only
--   exporterA: view + export               nograntA: nothing
select test.login(test.id('adminA'));
insert into public.data_permissions (company_id, user_id, table_id, can_view, can_create, can_edit) values
  (test.id('companyA'), test.id('editorA'), test.id('ordersA'), true, true, true);
insert into public.data_permissions (company_id, user_id, table_id, can_view) values
  (test.id('companyA'), test.id('viewerA'), test.id('ordersA'), true);
insert into public.data_permissions (company_id, user_id, table_id, can_view, can_export) values
  (test.id('companyA'), test.id('exporterA'), test.id('ordersA'), true, true);

insert into public.data_rows (company_id, table_id, data) values
  (test.id('companyA'), test.id('ordersA'), '{"sku":"PLY-18","qty":10}'),
  (test.id('companyA'), test.id('ordersA'), '{"sku":"PLY-12","qty":20}'),
  (test.id('companyA'), test.id('vendorsA'), '{"name":"Timber Co"}');
select test.logout();

select test.login(test.id('adminB'));
insert into public.data_rows (company_id, table_id, data) values
  (test.id('companyB'), test.id('ordersB'), '{"sku":"VEN-3"}'),
  (test.id('companyB'), test.id('ordersB'), '{"sku":"VEN-4"}');
select test.logout();
