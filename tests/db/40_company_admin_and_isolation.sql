-- Company-admin permissions and cross-tenant (A vs B) isolation.

select test.login(test.id('adminA'));

-- Own company
select test.ok(test.count('select 1 from public.companies') = 1
               and test.count($$select 1 from public.companies where id = test.id('companyA')$$) = 1,
  'admin A sees exactly company A');
select test.ok(test.affected($$update public.companies set name = 'Acme Plywood Ltd' where id = test.id('companyA')$$) = 1,
  'admin can rename own company');

-- Protected fields
select test.throws($$update public.companies set status = 'suspended' where id = test.id('companyA')$$, '42501',
  'admin cannot change company status (suspension is founder-only)');
select test.throws($$update public.subscriptions set trial_ends_at = now() + interval '3650 days'$$, '42501',
  'admin cannot extend their trial');
select test.throws($$update public.subscriptions set plan = 'enterprise', status = 'active'$$, '42501',
  'admin cannot change plan or subscription status');
select test.throws($$delete from public.companies where id = test.id('companyA')$$, '42501',
  'admin cannot delete the company');
select test.throws($$update public.company_members set role = 'admin' where user_id = test.id('editorA')$$, '42501',
  'admin cannot change memberships/roles through the API (server-side only)');
select test.throws($$insert into public.company_members (company_id, user_id, role)
                     values (test.id('companyA'), test.id('plain'), 'employee')$$, '42501',
  'admin cannot add members through the API (server-side provisioning only)');
select test.ok(test.count('select 1 from public.subscriptions') = 1, 'admin can read own subscription');

-- Cross-tenant: reads
select test.ok(test.count($$select 1 from public.companies where id = test.id('companyB')$$) = 0,
  'admin A cannot see company B');
select test.ok(test.count($$select 1 from public.company_members where company_id = test.id('companyB')$$) = 0,
  'admin A cannot see company B members');
select test.ok(test.count($$select 1 from public.subscriptions where company_id = test.id('companyB')$$) = 0,
  'admin A cannot see company B subscription');
select test.ok(test.count($$select 1 from public.table_metadata where company_id = test.id('companyB')$$) = 0,
  'admin A cannot see company B tables');
select test.ok(test.count($$select 1 from public.data_rows where table_id = test.id('ordersB')$$) = 0,
  'admin A cannot read company B rows even knowing the table id (no IDOR)');
select test.ok(test.count($$select 1 from public.audit_logs where company_id = test.id('companyB')$$) = 0,
  'admin A cannot read company B audit logs');

-- Cross-tenant: writes
select test.ok(test.affected($$update public.companies set name = 'Pwned' where id = test.id('companyB')$$) = 0,
  'admin A cannot rename company B');
select test.ok(test.affected($$update public.data_rows set data = '{"x":1}' where table_id = test.id('ordersB')$$) = 0,
  'admin A cannot update company B rows');
select test.ok(test.affected($$delete from public.data_rows where table_id = test.id('ordersB')$$) = 0,
  'admin A cannot delete company B rows');
select test.ok(test.affected($$delete from public.table_metadata where id = test.id('ordersB')$$) = 0,
  'admin A cannot delete company B tables');
select test.throws($$insert into public.table_metadata (company_id, name) values (test.id('companyB'), 'Injected')$$, '42501',
  'admin A cannot create tables in company B');
select test.throws($$insert into public.data_rows (company_id, table_id, data)
                     values (test.id('companyB'), test.id('ordersB'), '{"x":1}')$$, '42501',
  'admin A cannot insert rows into company B (company_id = B)');
select test.throws($$insert into public.data_rows (company_id, table_id, data)
                     values (test.id('companyA'), test.id('ordersB'), '{"x":1}')$$, '42501',
  'admin A cannot smuggle rows into B''s table by lying about company_id (policy)');
select test.throws($$insert into public.data_permissions (company_id, user_id, table_id, can_view)
                     values (test.id('companyA'), test.id('editorA'), test.id('ordersB'), true)$$, '23503',
  'permission rows cannot point at another company''s table (composite FK)');
select test.throws($$insert into public.data_permissions (company_id, user_id, table_id, can_view)
                     values (test.id('companyB'), test.id('empB'), test.id('ordersB'), true)$$, '42501',
  'admin A cannot grant permissions inside company B');
select test.logout();

-- Structural guarantee, independent of RLS (runs as the table owner, RLS bypassed).
select test.throws($$insert into public.data_rows (company_id, table_id, data)
                     values (test.id('companyA'), test.id('ordersB'), '{"x":1}')$$, '23503',
  'even with RLS bypassed, a row cannot reference another company''s table (composite FK)');

-- Symmetric check from B's side.
select test.login(test.id('adminB'));
select test.ok(test.count('select 1 from public.data_rows') = 2, 'admin B sees only company B rows');
select test.ok(test.count($$select 1 from public.data_rows where table_id = test.id('ordersA')$$) = 0,
  'admin B cannot read company A rows');
select test.ok(test.count('select 1 from public.table_metadata') = 1, 'admin B sees only company B tables');
select test.logout();

-- Table names are unique per company, not globally.
select test.ok((select count(*) from public.table_metadata where name = 'Orders') = 2,
  'two companies can each have a table named Orders');
select test.login(test.id('adminA'));
select test.throws($$insert into public.table_metadata (company_id, name) values (test.id('companyA'), 'orders')$$, '23505',
  'table names are unique per company (case-insensitive)');
select test.throws($$insert into public.table_metadata (company_id, name, columns) values (test.id('companyA'), 'Bad', '{}')$$, '23514',
  'table columns must be a JSON array');
select test.throws($$insert into public.data_rows (company_id, table_id, data) values (test.id('companyA'), test.id('ordersA'), '[1]')$$, '23514',
  'row data must be a JSON object');
select test.logout();

-- Admin cannot rewrite audit history.
select test.login(test.id('adminA'));
select test.throws($$update public.audit_logs set action = 'x'$$, '42501', 'admin cannot update audit logs');
select test.throws($$delete from public.audit_logs$$, '42501', 'admin cannot delete audit logs');
select test.throws($$insert into public.audit_logs (action) values ('forged')$$, '42501', 'admin cannot forge audit logs');
select test.ok(test.count('select 1 from public.audit_logs') >= 1, 'admin can read own company audit logs');
select test.logout();
