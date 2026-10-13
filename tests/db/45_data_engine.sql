-- Data engine: validation parity, table lifecycle, queries, schema edits, import.
-- Uses its own tables so fixtures used by later files stay untouched.

-- ---- shared vectors (also executed by the TypeScript validator) ----------------
\set vectors `cat :root/tests/shared/row-validation-vectors.json`

create function test.run_vectors(p jsonb) returns void language plpgsql as $$
declare v jsonb; err text; n int := 0;
begin
  for v in select value from jsonb_array_elements(p -> 'vectors') loop
    err := private.row_error(p -> 'columns', v -> 'data');
    if err is distinct from (v ->> 'error') then
      raise exception 'FAIL: row vector "%": expected %, got %', v ->> 'desc', coalesce(v ->> 'error', 'valid'), coalesce(err, 'valid');
    end if;
    n := n + 1;
  end loop;
  raise notice 'PASS: all % shared row-validation vectors match the SQL validator', n;
  n := 0;
  for v in select value from jsonb_array_elements(p -> 'column_vectors') loop
    err := private.validate_columns(v -> 'columns');
    if err is distinct from (v ->> 'error') then
      raise exception 'FAIL: column vector "%": expected %, got %', v ->> 'desc', coalesce(v ->> 'error', 'valid'), coalesce(err, 'valid');
    end if;
    n := n + 1;
  end loop;
  raise notice 'PASS: all % shared column-definition vectors match the SQL validator', n;
end $$;
select test.run_vectors(:'vectors'::jsonb);

-- ---- create a table (admin) ------------------------------------------------------
select test.login(test.id('adminA'));
select test.save('inv', (public.create_logical_table('Inventory', $c$[
  {"key":"sku","label":"SKU","type":"text","required":true},
  {"key":"qty","label":"Quantity","type":"integer"},
  {"key":"price","label":"Price","type":"number"},
  {"key":"in_stock","label":"In stock","type":"boolean"},
  {"key":"received","label":"Received","type":"date"}]$c$::jsonb)) ->> 'id');

select test.ok((public.get_table(test.id('inv')) ->> 'row_count')::int = 0
               and (public.get_table(test.id('inv')) -> 'access' ->> 'manage')::boolean,
  'create_logical_table returns the new table; admin has manage access');
select test.ok(exists (select 1 from public.audit_logs where action = 'table.created' and target_id = test.id('inv')),
  'table creation is audited');
select test.throws($$select public.create_logical_table('inventory', '[]')$$, '23505', 'table names are unique per company (case-insensitive)');
select test.throws($$select public.create_logical_table('   ', '[]')$$, '22023', 'blank table name rejected');
select test.throws($$select public.create_logical_table('Bad', '[{"key":"A","label":"x","type":"text"}]')$$, '22023', 'invalid column key rejected');
select test.logout();

select test.login(test.id('editorA'));
select test.throws($$select public.create_logical_table('Employee Table', '[]')$$, '42501', 'employees cannot create tables');
select test.throws($$select public.rename_logical_table(test.id('ordersA'), 'Nope')$$, '42501', 'employees cannot rename tables');
select test.throws($$select public.update_table_schema(test.id('ordersA'), '[]')$$, '42501', 'employees cannot edit schemas');
select test.throws($$select public.clear_table_rows(test.id('ordersA'))$$, '42501', 'employees cannot clear tables');
select test.throws($$select public.drop_logical_table(test.id('ordersA'))$$, '42501', 'employees cannot drop tables');
select test.logout();

select test.login(test.id('adminB'));
select test.throws($$select public.rename_logical_table(test.id('inv'), 'Stolen')$$, '42501', 'admin of company B cannot rename company A''s table');
select test.throws($$select public.update_table_schema(test.id('inv'), '[]')$$, '42501', 'admin of company B cannot edit company A''s schema');
select test.throws($$select public.clear_table_rows(test.id('inv'))$$, '42501', 'admin of company B cannot clear company A''s table');
select test.throws($$select public.drop_logical_table(test.id('inv'))$$, '42501', 'admin of company B cannot drop company A''s table');
select test.throws($$select public.import_rows(test.id('inv'), 'append', '[{"sku":"X"}]')$$, '42501', 'admin of company B cannot import into company A''s table');
select test.ok(public.get_table(test.id('inv')) is null, 'company A''s table is invisible to company B');
-- validation errors must never reveal another tenant's column labels
select test.throws($$select public.insert_row(test.id('inv'), '{"bogus":1}')$$, 'P0002', 'inserting into a foreign table says "not found", not a validation error');
select test.throws($$insert into public.data_rows (company_id, table_id, data) values (test.id('companyA'), test.id('inv'), '{"bogus":1}')$$, '42501',
  'a direct insert into a foreign table is denied by RLS before any validation can leak column names');
select test.logout();

-- ---- single-row writes + validation through the trigger -------------------------
select test.login(test.id('adminA'));
select test.ok((public.insert_row(test.id('inv'), '{"sku":"A-1","qty":5,"price":9.99,"in_stock":true,"received":"2026-03-01"}') -> 'data' ->> 'sku') = 'A-1',
  'insert_row stores a valid row');
select test.throws($$select public.insert_row(test.id('inv'), '{"qty":5}')$$, '23514', 'missing required column rejected');
select test.throws($$select public.insert_row(test.id('inv'), '{"sku":"B","qty":1.5}')$$, '23514', 'fractional integer rejected');
select test.throws($$select public.insert_row(test.id('inv'), '{"sku":"B","received":"2026-02-30"}')$$, '23514', 'impossible date rejected');
select test.throws($$select public.insert_row(test.id('inv'), '{"sku":"B","extra":1}')$$, '23514', 'unknown column rejected');
select test.throws($$insert into public.data_rows (company_id, table_id, data) values (test.id('companyA'), test.id('inv'), '{"qty":1}')$$, '23514',
  'direct DML is validated too (the trigger covers every write path)');

select public.insert_row(test.id('inv'), jsonb_build_object('sku', 'SKU-' || lpad(g::text, 3, '0'), 'qty', g, 'price', g * 1.5,
                                                            'in_stock', g % 2 = 0, 'received', '2026-01-' || lpad((g % 28 + 1)::text, 2, '0')))
from generate_series(1, 29) g;
select test.ok((public.get_table(test.id('inv')) ->> 'row_count')::int = 30, 'row_count is maintained by statement triggers (30 rows)');
select test.logout();

-- ---- queries: pagination, search, filters, sort ------------------------------------
select test.login(test.id('adminA'));
select test.ok((public.query_rows(test.id('inv')) ->> 'total')::int = 30
               and jsonb_array_length(public.query_rows(test.id('inv')) -> 'rows') = 30, 'default page returns the rows with the total');
select test.ok(jsonb_array_length(public.query_rows(test.id('inv'), null, '[]', null, 'asc', 0, 10) -> 'rows') = 10
               and jsonb_array_length(public.query_rows(test.id('inv'), null, '[]', null, 'asc', 25, 10) -> 'rows') = 5
               and (public.query_rows(test.id('inv'), null, '[]', null, 'asc', 25, 10) ->> 'total')::int = 30, 'pagination: pages and total');
select test.ok(jsonb_array_length(public.query_rows(test.id('inv'), null, '[]', null, 'asc', 0, 100000) -> 'rows') = 30
               and (public.query_rows(test.id('inv'), null, '[]', null, 'asc', 0, 100000) ->> 'limit')::int = 500, 'page size is capped at 500');
select test.ok((public.query_rows(test.id('inv'), 'SKU-007') ->> 'total')::int = 1, 'free-text search matches values');
select test.ok((public.query_rows(test.id('inv'), 'qty') ->> 'total')::int = 0, 'free-text search does not match column KEYS');
select test.ok((public.query_rows(test.id('inv'), '100%') ->> 'total')::int = 0, 'LIKE wildcards in the search term are escaped');
select test.ok((public.query_rows(test.id('inv'), null, '[{"key":"qty","op":"gt","value":"25"}]') ->> 'total')::int = 4, 'numeric filter gt (26..29)');
select test.ok((public.query_rows(test.id('inv'), null, '[{"key":"qty","op":"gte","value":"25"},{"key":"in_stock","op":"eq","value":"true"}]') ->> 'total')::int = 2,
  'filters combine with AND (qty>=25 and in_stock = 26, 28)');
select test.ok((public.query_rows(test.id('inv'), null, '[{"key":"sku","op":"contains","value":"-02"}]') ->> 'total')::int = 10, 'contains filter (SKU-020 .. SKU-029)');
select test.ok((public.query_rows(test.id('inv'), null, '[{"key":"price","op":"empty"}]') ->> 'total')::int = 0
               and (public.query_rows(test.id('inv'), null, '[{"key":"price","op":"notempty"}]') ->> 'total')::int = 30, 'empty / notempty filters');
select test.ok((public.query_rows(test.id('inv'), null, '[]', 'qty', 'desc', 0, 3) -> 'rows' -> 0 -> 'data' ->> 'qty')::int = 29,
  'numeric sort desc puts the largest first');
select test.ok((public.query_rows(test.id('inv'), null, '[]', 'qty', 'asc', 0, 3) -> 'rows' -> 0 -> 'data' ->> 'qty')::int = 1
               and (public.query_rows(test.id('inv'), null, '[]', 'qty', 'asc', 0, 40) -> 'rows' -> 9 -> 'data' ->> 'qty')::int = 9,
  'numeric sort asc is numeric, not lexical (9 before 10)');
select test.throws($$select public.query_rows(test.id('inv'), null, '[]', 'qty; drop table x', 'asc')$$, '22023', 'invalid sort key rejected');
select test.throws($$select public.query_rows(test.id('inv'), null, '[]', 'qty', 'sideways')$$, '22023', 'invalid sort direction rejected');
select test.throws($$select public.query_rows(test.id('inv'), null, '[{"key":"qty","op":"drop","value":"1"}]')$$, '22023', 'unknown filter operator rejected');
select test.throws($$select public.query_rows(test.id('inv'), null, '{"a":1}')$$, '22023', 'filters must be a list');
select test.logout();

-- ---- row update / delete ------------------------------------------------------------
select test.login(test.id('adminA'));
select test.save('inv_row', (public.query_rows(test.id('inv'), 'SKU-001') -> 'rows' -> 0 ->> 'id'));
select test.ok((public.update_row(test.id('inv'), test.id('inv_row'), '{"sku":"SKU-001","qty":100}') -> 'data' ->> 'qty')::int = 100, 'update_row stores a valid change');
select test.throws($$select public.update_row(test.id('inv'), test.id('inv_row'), '{"qty":"many"}')$$, '23514', 'update_row validates');
select test.throws($$select public.update_row(test.id('inv'), gen_random_uuid(), '{"sku":"x"}')$$, 'P0002', 'update_row on a missing row says not found');
select test.keep('del', to_jsonb(public.delete_rows(test.id('inv'), array[test.id('inv_row')])));
select test.ok(test.got('del') = '1'::jsonb and (public.get_table(test.id('inv')) ->> 'row_count')::int = 29, 'delete_rows removes the row and the count follows');
select test.throws($$select public.delete_rows(test.id('inv'), '{}')$$, '22023', 'delete_rows requires at least one id');
select test.logout();

-- ---- schema edits ------------------------------------------------------------------------
select test.login(test.id('adminA'));
select test.ok(jsonb_array_length(public.update_table_schema(test.id('inv'), $c$[
  {"key":"sku","label":"SKU code","type":"text","required":true},
  {"key":"qty","label":"Quantity","type":"integer"},
  {"key":"price","label":"Price","type":"number"},
  {"key":"in_stock","label":"In stock","type":"boolean"},
  {"key":"received","label":"Received","type":"date"},
  {"key":"notes","label":"Notes","type":"text"}]$c$::jsonb) -> 'columns') = 6, 'columns can be added and relabelled');
select test.ok((public.query_rows(test.id('inv'), 'SKU-005') -> 'rows' -> 0 -> 'data' ->> 'sku') = 'SKU-005',
  'relabelling a column does not touch row data (keys are stable)');
select test.throws($c$select public.update_table_schema(test.id('inv'), '[{"key":"sku","label":"SKU","type":"text","required":true},{"key":"qty","label":"Qty","type":"integer"},{"key":"price","label":"Price","type":"number"},{"key":"in_stock","label":"In stock","type":"boolean"},{"key":"received","label":"Received","type":"date"},{"key":"notes","label":"Notes","type":"text"},{"key":"must_have","label":"Must have","type":"text","required":true}]')$c$, '23514',
  'a required column cannot be added to a table that already has rows');
select test.throws($c$select public.update_table_schema(test.id('inv'), '[{"key":"sku","label":"SKU","type":"integer"},{"key":"qty","label":"Qty","type":"integer"},{"key":"price","label":"Price","type":"number"},{"key":"in_stock","label":"In stock","type":"boolean"},{"key":"received","label":"Received","type":"date"},{"key":"notes","label":"Notes","type":"text"}]')$c$, '23514',
  'retyping a column is refused when existing values do not fit');
select test.throws($c$select public.update_table_schema(test.id('inv'), '[{"key":"sku","label":"SKU","type":"text"},{"key":"qty","label":"Qty","type":"integer"},{"key":"price","label":"Price","type":"number"},{"key":"in_stock","label":"In stock","type":"boolean"},{"key":"received","label":"Received","type":"date"},{"key":"notes","label":"Notes","type":"text","required":true}]')$c$, '23514',
  'a column with empty values cannot be made required');
select test.ok(jsonb_array_length(public.update_table_schema(test.id('inv'), $c$[
  {"key":"sku","label":"SKU","type":"text","required":true},
  {"key":"qty","label":"Qty","type":"number"},
  {"key":"price","label":"Price","type":"number"},
  {"key":"in_stock","label":"In stock","type":"boolean"},
  {"key":"received","label":"Received","type":"date"},
  {"key":"notes","label":"Notes","type":"text"}]$c$::jsonb) -> 'columns') = 6, 'integer -> number is allowed when all values fit');

select public.update_row(test.id('inv'), (public.query_rows(test.id('inv'), 'SKU-005') -> 'rows' -> 0 ->> 'id')::uuid, '{"sku":"SKU-005","qty":5,"notes":"keep?"}');
select test.ok(jsonb_array_length(public.update_table_schema(test.id('inv'), $c$[
  {"key":"sku","label":"SKU","type":"text","required":true},
  {"key":"qty","label":"Qty","type":"number"}]$c$::jsonb) -> 'columns') = 2, 'columns can be removed');
select test.ok(not exists (select 1 from public.data_rows where table_id = test.id('inv') and (data ? 'notes' or data ? 'price')),
  'removed columns are stripped from every row');
select test.ok(exists (select 1 from public.audit_logs where action = 'table.schema_updated' and target_id = test.id('inv')),
  'schema edits are audited');
select test.logout();

-- ---- import: append / replace / atomicity ------------------------------------------------
select test.login(test.id('adminA'));
select test.keep('imp1', public.import_rows(test.id('inv'), 'append', '[{"sku":"I-1","qty":1},{"sku":"I-2","qty":2},{"sku":"I-3"}]', 'a.csv'));
select test.ok((test.got('imp1') ->> 'inserted')::int = 3
               and (public.get_table(test.id('inv')) ->> 'row_count')::int = 32, 'append adds rows and keeps existing ones');
select test.keep('imp2', public.import_rows(test.id('inv'), 'append', '[{"sku":"OK"},{"qty":2},{"sku":"X","qty":"bad"}]', 'bad.csv'));
select test.ok(test.got('imp2') ->> 'ok' = 'false' and (test.got('imp2') ->> 'error_count')::int = 2
               and (public.get_table(test.id('inv')) ->> 'row_count')::int = 32, 'append with invalid rows is all-or-nothing and reports errors');
select test.ok((select error_summary -> 'errors' -> 0 ->> 'row' from public.import_jobs where file_name = 'bad.csv') = '2'
               and (select status from public.import_jobs where file_name = 'bad.csv') = 'failed', 'a failed import is recorded with the offending row number');
select test.ok(public.import_rows(test.id('inv'), 'append', '[]') ->> 'ok' = 'false', 'an empty import is rejected');
select test.throws($$select public.import_rows(test.id('inv'), 'merge', '[{"sku":"x"}]')$$, '22023', 'unknown import mode rejected');
select test.throws($$select public.import_rows(test.id('inv'), 'append', '{"sku":"x"}')$$, '22023', 'rows must be a list');

-- replace: validate first, delete only when ready
select test.keep('imp3', public.import_rows(test.id('inv'), 'replace', '[{"sku":"R-1"},{"qty":"oops"}]', 'bad-replace.csv'));
select test.ok(test.got('imp3') ->> 'ok' = 'false'
               and (public.get_table(test.id('inv')) ->> 'row_count')::int = 32
               and exists (select 1 from public.data_rows where table_id = test.id('inv') and data ->> 'sku' = 'I-1'),
  'an invalid replacement leaves the existing records completely untouched');
select test.keep('imp4', public.import_rows(test.id('inv'), 'replace', '[{"sku":"R-1","qty":1},{"sku":"R-2","qty":2},{"sku":"R-3","qty":3}]', 'good.csv'));
select test.ok((test.got('imp4') ->> 'deleted')::int = 32
               and (public.get_table(test.id('inv')) ->> 'row_count')::int = 3
               and (select array_agg(data ->> 'sku' order by row_order) from public.data_rows where table_id = test.id('inv')) = array['R-1','R-2','R-3'],
  'replace swaps the records, keeps the definition, and preserves file order');
select test.ok((public.get_table(test.id('inv')) -> 'columns' -> 0 ->> 'key') = 'sku', 'replace preserves the logical table definition');
select test.ok(exists (select 1 from public.audit_logs where action = 'import.replace' and target_id = test.id('inv'))
               and exists (select 1 from public.audit_logs where action = 'import.failed' and target_id = test.id('inv')), 'imports are audited (success and failure)');
select test.logout();

-- unexpected failure in the middle of a replacement must roll the DELETE back as well
create function test.fail_on_third_row() returns trigger language plpgsql as $$
begin
  if new.data ->> 'sku' = 'BOOM' then raise exception 'simulated storage failure' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger zz_test_boom after insert on public.data_rows for each row execute function test.fail_on_third_row();

select test.login(test.id('adminA'));
select test.throws($$select public.import_rows(test.id('inv'), 'replace', '[{"sku":"N-1"},{"sku":"N-2"},{"sku":"BOOM"},{"sku":"N-4"}]', 'boom.csv')$$, 'P0001',
  'an unexpected error during replacement aborts the whole call');
select test.logout();
drop trigger zz_test_boom on public.data_rows;
drop function test.fail_on_third_row();
select test.login(test.id('adminA'));
select test.throws($$select public.insert_row(test.id('inv'), '{"qty":1}')$$, '23514',
  'validation is still enforced after an aborted import (the transaction-local skip flag was rolled back)');
select test.logout();
select test.ok((select count(*) from public.data_rows where table_id = test.id('inv')) = 3
               and (select array_agg(data ->> 'sku' order by row_order) from public.data_rows where table_id = test.id('inv')) = array['R-1','R-2','R-3']
               and (select row_count from public.table_metadata where id = test.id('inv')) = 3,
  'atomic replace: after a mid-insert failure the ORIGINAL rows are all still there (delete rolled back)');

-- ---- import authorization ----------------------------------------------------------------------
select test.login(test.id('adminA'));
select public.set_table_permission(test.id('viewerA'), test.id('inv'), true, false, false, false, true, false);   -- view + import
select public.set_table_permission(test.id('exporterA'), test.id('inv'), true, false, false, false, false, true);  -- view + export
select test.logout();

select test.login(test.id('viewerA'));
select test.keep('imp5', public.import_rows(test.id('inv'), 'append', '[{"sku":"V-1"}]', 'v.csv'));
select test.ok((test.got('imp5') ->> 'inserted')::int = 1, 'an employee with can_import may APPEND');
select test.throws($$select public.import_rows(test.id('inv'), 'replace', '[{"sku":"V-2"}]')$$, '42501', 'an employee may never REPLACE, even with can_import');
select test.ok((select count(*) from jsonb_array_elements(public.list_import_jobs(test.id('inv')))) >= 1
               and not exists (select 1 from jsonb_array_elements(public.list_import_jobs(test.id('inv'))) j where j ->> 'created_by' <> test.id('viewerA')::text),
  'an employee sees only their own import jobs');
select test.logout();

select test.login(test.id('exporterA'));
select test.throws($$select public.import_rows(test.id('inv'), 'append', '[{"sku":"E-1"}]')$$, '42501', 'an employee without can_import cannot import');
select test.logout();

select test.login(test.id('nograntA'));
select test.throws($$select public.import_rows(test.id('inv'), 'append', '[{"sku":"N-1"}]')$$, '42501', 'an employee with no grant cannot import');
select test.logout();

select test.login(test.id('adminA'));
select test.ok(jsonb_array_length(public.list_import_jobs(test.id('inv'))) >= 5, 'the admin sees every import job for the table');
select test.ok(jsonb_array_length(public.list_tables()) = 3, 'the admin lists all of the company''s tables (Orders, Vendors, Inventory)');
select test.logout();
select test.login(test.id('viewerA'));
select test.ok(jsonb_array_length(public.list_tables()) = 2, 'an employee lists only tables they can view (Orders, Inventory)');
select test.ok((public.get_table(test.id('inv')) -> 'access' ->> 'import')::boolean and not (public.get_table(test.id('inv')) -> 'access' ->> 'manage')::boolean,
  'the table payload carries the caller''s access flags');
select test.logout();

-- ---- row-limit guard (50000 per import) ----------------------------------------------------------
select test.login(test.id('adminA'));
select test.ok(public.import_rows(test.id('inv'), 'append',
  (select jsonb_agg(jsonb_build_object('sku', 's' || g)) from generate_series(1, 50001) g)) ->> 'ok' = 'false',
  'more than 50000 rows in one import is rejected');
select test.logout();

-- ---- clear + drop -----------------------------------------------------------------------------------
select test.login(test.id('adminA'));
select test.keep('clr', to_jsonb(public.clear_table_rows(test.id('inv'))));
select test.ok(test.got('clr') = '4'::jsonb and (public.get_table(test.id('inv')) ->> 'row_count')::int = 0, 'clear_table_rows empties the table and returns the count');
select test.ok(public.get_table(test.id('inv')) is not null, 'clearing keeps the table definition');
select public.drop_logical_table(test.id('inv'));
select test.ok(public.get_table(test.id('inv')) is null, 'drop_logical_table removes the table');
select test.logout();
select test.ok(not exists (select 1 from public.data_permissions where table_id = test.id('inv'))
               and exists (select 1 from public.import_jobs where table_name = 'Inventory'), 'dropping cascades permissions but keeps import history');
select test.ok(exists (select 1 from public.audit_logs where action = 'table.cleared' and target_id = test.id('inv'))
               and exists (select 1 from public.audit_logs where action = 'table.dropped' and target_id = test.id('inv')), 'clear and drop are audited');
