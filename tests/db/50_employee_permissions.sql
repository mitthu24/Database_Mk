-- Employee permissions: editor (view+create+edit), viewer (view), exporter
-- (view+export), no-grant, and an employee of the other company.

-- ---- editorA: view + create + edit, but not delete / export ------------------
select test.login(test.id('editorA'));
select test.ok(test.count('select 1 from public.table_metadata') = 1, 'editor sees only the granted table (Orders), not Vendors');
select test.ok(test.count($$select 1 from public.data_rows where table_id = test.id('ordersA')$$) = 2, 'editor can read granted rows');
select test.ok(test.count($$select 1 from public.data_rows where table_id = test.id('vendorsA')$$) = 0, 'editor cannot read ungranted table rows');
select test.ok(test.affected($$insert into public.data_rows (company_id, table_id, data)
                               values (test.id('companyA'), test.id('ordersA'), '{"sku":"NEW","qty":1}')$$) = 1,
  'editor with can_create can insert a row');
select test.ok(test.affected($$update public.data_rows set data = '{"sku":"EDITED","qty":2}'
                               where table_id = test.id('ordersA') and data ->> 'sku' = 'NEW'$$) = 1,
  'editor with can_edit can update a row');
select test.ok(test.affected($$delete from public.data_rows where table_id = test.id('ordersA')$$) = 0,
  'editor without can_delete cannot delete rows');
select test.throws($$insert into public.data_rows (company_id, table_id, data)
                     values (test.id('companyA'), test.id('vendorsA'), '{"name":"x"}')$$, '42501',
  'editor cannot insert into an ungranted table');
select test.throws($$select public.authorize_export(test.id('ordersA'))$$, '42501',
  'editor without can_export is refused by the export gate');
-- privilege escalation attempts
select test.ok(test.affected($$update public.data_permissions set can_delete = true where user_id = auth.uid()$$) = 0,
  'employee cannot grant themselves more permissions (update affects 0 rows)');
select test.ok(test.affected($$delete from public.data_permissions where user_id = auth.uid()$$) = 0,
  'employee cannot delete their own (or anyone''s) grant rows');
select test.throws($$insert into public.data_permissions (company_id, user_id, table_id, can_view)
                     values (test.id('companyA'), auth.uid(), test.id('vendorsA'), true)$$, '42501',
  'employee cannot grant themselves access to another table (insert)');
select test.throws($$insert into public.table_metadata (company_id, name) values (test.id('companyA'), 'EmployeeTable')$$, '42501',
  'employee cannot create tables');
select test.ok(test.affected($$update public.table_metadata set name = 'Renamed' where id = test.id('ordersA')$$) = 0,
  'employee cannot rename tables');
select test.ok(test.affected($$delete from public.table_metadata where id = test.id('ordersA')$$) = 0,
  'employee cannot delete tables');
select test.ok(test.affected($$update public.companies set name = 'Mine' where id = test.id('companyA')$$) = 0,
  'employee cannot rename the company');
select test.ok(test.count('select 1 from public.subscriptions') = 0, 'employee cannot read subscription details');
select test.ok(test.count('select 1 from public.audit_logs') = 0, 'employee cannot read audit logs');
select test.ok(test.count($$select 1 from public.data_permissions$$) = 1, 'employee can read only their own grant row');
select test.ok(test.count('select 1 from public.company_members') = 1, 'employee sees only their own membership row');
select test.ok(public.get_my_context() ->> 'role' = 'employee' and public.get_my_context() ->> 'access' = 'full',
  'get_my_context: employee role from trusted data');
select test.logout();

-- ---- viewerA: view only ------------------------------------------------------
select test.login(test.id('viewerA'));
select test.ok(test.count($$select 1 from public.data_rows where table_id = test.id('ordersA')$$) = 3, 'viewer can read rows');
select test.throws($$insert into public.data_rows (company_id, table_id, data)
                     values (test.id('companyA'), test.id('ordersA'), '{"sku":"V"}')$$, '42501',
  'viewer without can_create cannot insert');
select test.ok(test.affected($$update public.data_rows set data = '{"hacked":true}' where table_id = test.id('ordersA')$$) = 0,
  'viewer without can_edit cannot update');
select test.ok(test.affected($$delete from public.data_rows where table_id = test.id('ordersA')$$) = 0,
  'viewer without can_delete cannot delete');
select test.throws($$select public.authorize_export(test.id('ordersA'))$$, '42501', 'viewer without can_export is refused by the export gate');
select test.logout();

-- ---- exporterA: view + export ------------------------------------------------
select test.login(test.id('exporterA'));
select test.ok(test.count($$select public.authorize_export(test.id('ordersA'))$$) = 1,
  'employee with can_export passes the export gate');
select test.throws($$select public.authorize_export(test.id('vendorsA'))$$, '42501',
  'can_export on one table does not authorize another');
select test.throws($$select public.authorize_export(gen_random_uuid())$$, '42501',
  'unknown table id gives the same error as forbidden (no probing)');
select test.throws($$select public.authorize_export(test.id('ordersB'))$$, '42501',
  'cannot authorize export of another company''s table');
select test.logout();
select test.ok(exists (select 1 from public.audit_logs
                       where action = 'data.export_authorized' and actor_id = test.id('exporterA')
                         and target_id = test.id('ordersA')),
  'granted export authorization is audited');

-- ---- nograntA: member with no grants ------------------------------------------
select test.login(test.id('nograntA'));
select test.ok(test.count('select 1 from public.table_metadata') = 0, 'employee with no grants sees no tables');
select test.ok(test.count('select 1 from public.data_rows') = 0, 'employee with no grants sees no rows');
select test.ok(public.get_my_context() ->> 'access' = 'full', 'employee with no grants still has an active membership');
select test.logout();

-- ---- empB: other company -----------------------------------------------------
select test.login(test.id('empB'));
select test.ok(test.count('select 1 from public.data_rows') = 0, 'company B employee without grants sees nothing');
select test.ok(test.count($$select 1 from public.data_rows where table_id = test.id('ordersA')$$) = 0,
  'company B employee cannot read company A rows');
select test.throws($$insert into public.data_rows (company_id, table_id, data)
                     values (test.id('companyA'), test.id('ordersA'), '{"x":1}')$$, '42501',
  'company B employee cannot write into company A');
select test.throws($$select public.authorize_export(test.id('ordersA'))$$, '42501',
  'company B employee cannot pass company A export gate');
select test.logout();

-- ---- admin permission management ---------------------------------------------
select test.login(test.id('adminA'));
select test.throws($$insert into public.data_permissions (company_id, user_id, table_id, can_edit)
                     values (test.id('companyA'), test.id('nograntA'), test.id('ordersA'), true)$$, '23514',
  'a grant must include can_view when granting anything else (check constraint)');
select test.throws($$insert into public.data_permissions (company_id, user_id, table_id, can_view)
                     values (test.id('companyA'), test.id('empB'), test.id('ordersA'), true)$$, '23503',
  'cannot grant permissions to a user outside the company (composite FK)');
select test.ok(test.affected($$update public.data_permissions set can_delete = true
                               where user_id = test.id('editorA')$$) = 1,
  'admin can add can_delete for the editor');
select test.logout();

select test.login(test.id('editorA'));
select test.ok(test.affected($$delete from public.data_rows where data ->> 'sku' = 'EDITED'$$) = 1,
  'after admin grants can_delete, the editor can delete');
select test.logout();

-- ---- disabled member loses everything ----------------------------------------
update public.company_members set status = 'disabled' where user_id = test.id('editorA');
select test.login(test.id('editorA'));
select test.ok(test.count('select 1 from public.table_metadata') = 0, 'disabled member sees no tables');
select test.ok(test.count('select 1 from public.data_rows') = 0, 'disabled member sees no rows');
select test.ok(public.get_my_context() ->> 'access' = 'disabled', 'get_my_context reports disabled access');
select test.logout();
update public.company_members set status = 'active' where user_id = test.id('editorA');
