-- NOT part of the test suite: run through scripts/capture-contracts.sh.
-- Records the REAL jsonb output of every RPC (after the full test run) into
-- tests/fixtures/contracts/*.json. tests/unit/contracts.test.ts parses them with
-- the exact Zod schemas the Supabase adapter uses.
\t on
\a
\set dir :root /tests/fixtures/contracts/

\set f :dir context_admin.json
\o :f
select test.login(test.id('adminA')); select jsonb_pretty(public.get_my_context());
\set f :dir context_employee.json
\o :f
select test.logout(); select test.login(test.id('editorA')); select jsonb_pretty(public.get_my_context());
\set f :dir context_founder.json
\o :f
select test.logout(); select test.login(test.id('founder')); select jsonb_pretty(public.get_my_context());
\set f :dir context_no_company.json
\o :f
select test.logout(); select test.login(test.id('plain')); select jsonb_pretty(public.get_my_context());

\o
select test.logout(); select test.login(test.id('adminA'));
\set f :dir tables.json
\o :f
select jsonb_pretty(public.list_tables());
\set f :dir table.json
\o :f
select jsonb_pretty(public.get_table(test.id('ordersA')));
\set f :dir rows.json
\o :f
select jsonb_pretty(public.query_rows(test.id('ordersA'), null, '[]', 'qty', 'desc', 0, 3));
\set f :dir row.json
\o :f
select jsonb_pretty(public.insert_row(test.id('ordersA'), '{"sku":"CONTRACT-1","qty":1}'));
\set f :dir company_profile.json
\o :f
select jsonb_pretty(public.get_company_profile());
\set f :dir members.json
\o :f
select jsonb_pretty(public.list_members());
\set f :dir permissions.json
\o :f
select jsonb_pretty(public.list_permissions());
\set f :dir company_audit.json
\o :f
select jsonb_pretty(public.list_company_audit(null, 5, 0));
\set f :dir payments.json
\o :f
select jsonb_pretty(public.list_payments());
\set f :dir settings.json
\o :f
select jsonb_pretty(public.get_platform_settings());

\o
select test.save('ct_table', (public.create_logical_table('Contract Table', '[{"key":"sku","label":"SKU","type":"text","required":true}]') ->> 'id'));
\set f :dir import_ok.json
\o :f
select jsonb_pretty(public.import_rows(test.id('ct_table'), 'append', '[{"sku":"a"},{"sku":"b"}]', 'ok.csv'));
\set f :dir import_failed.json
\o :f
select jsonb_pretty(public.import_rows(test.id('ct_table'), 'append', '[{"sku":"a"},{"nope":1}]', 'bad.csv'));
\set f :dir import_jobs.json
\o :f
select jsonb_pretty(public.list_import_jobs(null, 20));
\o

select test.logout();
insert into auth.users (id, email, raw_user_meta_data, email_confirmed_at)
values ('e0000000-0000-0000-0000-0000000000ff', 'contract-admin@test.local', '{}', now());
insert into test.ids (name, id) values ('contract_admin', 'e0000000-0000-0000-0000-0000000000ff');
select test.logout(); select test.login(test.id('founder'));
\set f :dir founder_overview.json
\o :f
select jsonb_pretty(public.founder_overview());
\set f :dir founder_companies.json
\o :f
select jsonb_pretty(public.founder_list_companies(null, 'all', 5, 0));
\set f :dir founder_company_detail.json
\o :f
select jsonb_pretty(public.founder_company_detail(test.id('companyA')));
\set f :dir founder_members.json
\o :f
select jsonb_pretty(public.founder_list_members(test.id('companyA')));
\set f :dir founder_payments.json
\o :f
select jsonb_pretty(public.founder_list_payments(null, 5, 0));
\set f :dir founder_audit.json
\o :f
select jsonb_pretty(public.founder_audit(null, null, 5, 0));
\set f :dir founder_review.json
\o :f
select jsonb_pretty(public.founder_review_payment((select id from public.manual_payments where status = 'pending' order by created_at limit 1), 'reject', 'contract capture'));
\set f :dir founder_create_company.json
\o :f
select jsonb_pretty(public.founder_create_company(test.id('contract_admin'), 'Contract Co'));
\o
select test.logout();
