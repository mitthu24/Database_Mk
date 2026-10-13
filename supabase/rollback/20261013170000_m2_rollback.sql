-- M2+ ROLLBACK (migrations 05-07) — NOT a migration; deliberately outside
-- supabase/migrations/ so it can never be applied by `supabase db push`.
--
-- Restores the exact state left by the four M1 migrations. It DESTROYS all data
-- in the tables added by 05-07 (import history, manual payments, platform
-- settings) AND all logical-table data rows' bookkeeping columns. Customer
-- rows in data_rows are NOT deleted, but their validation and row counting
-- stop. Take a backup first. Run BEFORE the M1 rollback if you want to remove M1
-- as well (the M1 rollback refuses while these objects still exist).
--
--   set app.confirm_m2_rollback = 'yes';
--   \i supabase/rollback/20261013170000_m2_rollback.sql

begin;

do $$
begin
  if coalesce(current_setting('app.confirm_m2_rollback', true), '') <> 'yes' then
    raise exception 'Refusing to roll back M2+: run "set app.confirm_m2_rollback = ''yes'';" first, after taking a backup.';
  end if;
end $$;

-- ---- 07 ----------------------------------------------------------------------
drop function public.get_company_profile();
drop function public.update_company_profile(text, text, text, text);
drop function public.update_my_profile(text);
drop function public.list_members();
drop function public.add_company_member(uuid, text);
drop function public.set_member_status(uuid, text);
drop function public.set_member_role(uuid, text);
drop function public.set_member_code(uuid, text);
drop function public.list_permissions(uuid);
drop function public.set_table_permission(uuid, uuid, boolean, boolean, boolean, boolean, boolean, boolean);
drop function public.list_company_audit(text, integer, integer);
drop function public.founder_overview();
drop function public.founder_list_companies(text, text, integer, integer);
drop function public.founder_company_detail(uuid);
drop function public.founder_list_members(uuid);
drop function public.founder_list_payments(text, integer, integer);
drop function public.founder_audit(uuid, text, integer, integer);
drop function public.founder_create_company(uuid, text);
drop function private.next_employee_code(uuid);
drop function private.member_json(public.company_members);
drop function private.company_access(uuid);
drop function private.require_founder();
alter table public.companies drop column contact_email, drop column phone, drop column address;

-- ---- 06 ----------------------------------------------------------------------
drop function public.get_platform_settings();
drop function public.founder_update_setting(text, text);
drop function public.submit_manual_payment(numeric, text, integer, text, text, text);
drop function public.list_payments();
drop function public.founder_review_payment(uuid, text, text);
drop function private.payment_json(public.manual_payments);
drop table public.manual_payments;
drop table public.platform_settings;

-- M1 behaviour of founder_set_subscription (may set any status, including active)
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

-- ---- 05 ----------------------------------------------------------------------
drop function public.list_tables();
drop function public.get_table(uuid);
drop function public.query_rows(uuid, text, jsonb, text, text, integer, integer);
drop function public.insert_row(uuid, jsonb);
drop function public.update_row(uuid, uuid, jsonb);
drop function public.delete_rows(uuid, uuid[]);
drop function public.create_logical_table(text, jsonb);
drop function public.rename_logical_table(uuid, text);
drop function public.update_table_schema(uuid, jsonb);
drop function public.clear_table_rows(uuid);
drop function public.drop_logical_table(uuid);
drop function public.import_rows(uuid, text, jsonb, text);
drop function public.list_import_jobs(uuid, integer);

drop trigger data_rows_validate on public.data_rows;
drop trigger data_rows_count_insert on public.data_rows;
drop trigger data_rows_count_delete on public.data_rows;
drop trigger data_rows_touch_update on public.data_rows;
drop trigger table_metadata_validate on public.table_metadata;
drop trigger set_updated_at on public.table_metadata;
create trigger set_updated_at before update on public.table_metadata
  for each row execute function private.set_updated_at();

drop function private.data_rows_validate();
drop function private.table_metadata_validate();
drop function private.rows_after_insert();
drop function private.rows_after_delete();
drop function private.rows_after_update();
drop function private.table_json(public.table_metadata);
drop function private.table_access(uuid);
drop function private.match_filter(jsonb, text, text, text);
drop function private.row_error(jsonb, jsonb);
drop function private.validate_columns(jsonb);
drop function private.my_admin_company();
drop function private.my_company();
drop function private.row_text(jsonb);
drop function private.like_escape(text);
drop function private.try_numeric(text);

drop table public.import_jobs;
alter table public.table_metadata drop column data_updated_at;

commit;
