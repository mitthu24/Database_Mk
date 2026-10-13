import "server-only";

import { createClient as createStatelessClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { toAuthErrorCode, mapDatabaseError } from "@/lib/backend/errors";
import {
  BackendError,
  type AuthAdminPort,
  type AuthPort,
  type AuthResult,
    type DataPort,
} from "@/lib/backend/port";
import * as S from "@/lib/backend/schemas";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireSupabaseConfig } from "@/lib/supabase/config";

type Client = SupabaseClient;

async function rpc<O, I = unknown>(client: Client, fn: string, args: Record<string, unknown> | undefined, schema: z.ZodType<O, I>): Promise<O> {
  let result: { data: unknown; error: { code?: string; message?: string; details?: string } | null; status?: number };
  try {
    result = await client.rpc(fn, args);
  } catch (e) {
    throw mapDatabaseError({ message: e instanceof Error ? e.message : String(e) });
  }
  if (result.error) throw mapDatabaseError({ ...result.error, status: result.status });
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    throw new BackendError("unknown", "The server returned an unexpected response.", "bad_shape");
  }
  return parsed.data;
}

const none = z.unknown().transform(() => undefined);

export function createSupabaseDataPort(client: Client): DataPort {
  return {
    getContext: () => rpc(client, "get_my_context", undefined, S.contextSchema),
    getCompanyProfile: () => rpc(client, "get_company_profile", undefined, S.companyProfileSchema.nullable()),
    updateCompanyProfile: (i) =>
      rpc(client, "update_company_profile", { p_name: i.name, p_contact_email: i.contactEmail, p_phone: i.phone, p_address: i.address }, S.companyProfileSchema),
    updateMyProfile: (fullName) => rpc(client, "update_my_profile", { p_full_name: fullName }, none),
    registerCompany: (name) => rpc(client, "register_company", { p_name: name }, z.string()),

    listTables: () => rpc(client, "list_tables", undefined, S.tableListSchema),
    getTable: (id) => rpc(client, "get_table", { p_table: id }, S.tableOrNullSchema),
    createTable: (name, columns) => rpc(client, "create_logical_table", { p_name: name, p_columns: columns }, S.tableSchema),
    renameTable: (id, name) => rpc(client, "rename_logical_table", { p_table: id, p_name: name }, S.tableSchema),
    updateTableSchema: (id, columns) => rpc(client, "update_table_schema", { p_table: id, p_columns: columns }, S.tableSchema),
    clearTable: (id) => rpc(client, "clear_table_rows", { p_table: id }, z.number()),
    dropTable: (id) => rpc(client, "drop_logical_table", { p_table: id }, none),

    queryRows: (tableId, q = {}) =>
      rpc(
        client,
        "query_rows",
        {
          p_table: tableId,
          p_search: q.search ?? null,
          p_filters: q.filters ?? [],
          p_sort_key: q.sortKey ?? null,
          p_sort_dir: q.sortDir ?? "asc",
          p_offset: q.offset ?? 0,
          p_limit: q.limit ?? 50,
        },
        S.rowPageSchema,
      ),
    insertRow: (tableId, data) => rpc(client, "insert_row", { p_table: tableId, p_data: data }, S.rowRecordSchema),
    updateRow: (tableId, rowId, data) => rpc(client, "update_row", { p_table: tableId, p_row: rowId, p_data: data }, S.rowRecordSchema),
    deleteRows: (tableId, rowIds) => rpc(client, "delete_rows", { p_table: tableId, p_ids: rowIds }, z.number()),

    importRows: (tableId, mode, rows, fileName) =>
      rpc(client, "import_rows", { p_table: tableId, p_mode: mode, p_rows: rows, p_file_name: fileName }, S.importOutcomeSchema),
    listImportJobs: (tableId, limit) => rpc(client, "list_import_jobs", { p_table: tableId ?? null, p_limit: limit ?? 50 }, S.importJobsSchema),
    authorizeExport: (tableId) => rpc(client, "authorize_export", { p_table_id: tableId }, none),

    listMembers: () => rpc(client, "list_members", undefined, S.memberListSchema),
    addMember: (userId, code) => rpc(client, "add_company_member", { p_user: userId, p_employee_code: code ?? null }, S.memberSchema),
    setMemberStatus: (id, status) => rpc(client, "set_member_status", { p_member: id, p_status: status }, S.memberSchema),
    setMemberRole: (id, role) => rpc(client, "set_member_role", { p_member: id, p_role: role }, S.memberSchema),
    setMemberCode: (id, code) => rpc(client, "set_member_code", { p_member: id, p_code: code }, S.memberSchema),
    listPermissions: (userId) => rpc(client, "list_permissions", { p_user: userId ?? null }, S.permissionListSchema),
    setTablePermission: (userId, tableId, f) =>
      rpc(
        client,
        "set_table_permission",
        { p_user: userId, p_table: tableId, p_view: f.view, p_create: f.create, p_edit: f.edit, p_delete: f.delete, p_import: f.import, p_export: f.export },
        none,
      ),
    listCompanyAudit: (q = {}) =>
      rpc(client, "list_company_audit", { p_action: q.action ?? null, p_limit: q.limit ?? 50, p_offset: q.offset ?? 0 }, S.auditPageSchema),

    listPayments: () => rpc(client, "list_payments", undefined, S.paymentListSchema),
    submitPayment: (i) =>
      rpc(
        client,
        "submit_manual_payment",
        { p_amount: i.amount, p_currency: i.currency, p_months: i.months, p_method: i.method, p_reference: i.reference, p_note: i.note || null },
        S.paymentSchema,
      ),
    getPlatformSettings: () => rpc(client, "get_platform_settings", undefined, S.settingsSchema),

    founderOverview: () => rpc(client, "founder_overview", undefined, S.founderOverviewSchema),
    founderListCompanies: (q = {}) =>
      rpc(client, "founder_list_companies", { p_search: q.search ?? null, p_state: q.state ?? "all", p_limit: q.limit ?? 25, p_offset: q.offset ?? 0 }, S.founderCompanyPageSchema),
    founderCompanyDetail: (id) => rpc(client, "founder_company_detail", { p_company: id }, S.founderCompanyDetailSchema),
    founderListMembers: (id) => rpc(client, "founder_list_members", { p_company: id }, S.memberListSchema),
    founderListPayments: (status, limit, offset) =>
      rpc(client, "founder_list_payments", { p_status: status ?? null, p_limit: limit ?? 25, p_offset: offset ?? 0 }, S.paymentPageSchema),
    founderReviewPayment: (id, decision, note) =>
      rpc(client, "founder_review_payment", { p_payment: id, p_decision: decision, p_note: note ?? null }, S.paymentSchema),
    founderAudit: (q = {}) =>
      rpc(client, "founder_audit", { p_company: q.companyId ?? null, p_action: q.action ?? null, p_limit: q.limit ?? 50, p_offset: q.offset ?? 0 }, S.auditPageSchema),
    founderSetCompanyStatus: (id, status, reason) =>
      rpc(client, "founder_set_company_status", { p_company: id, p_status: status, p_reason: reason ?? null }, none),
    founderSetSubscription: (id, change) =>
      rpc(
        client,
        "founder_set_subscription",
        {
          p_company: id,
          p_plan: change.status === "trialing" ? "trial" : "standard",
          p_status: change.status,
          p_trial_ends_at: change.trialEndsAt ?? null,
          p_current_period_end: null,
        },
        none,
      ),
    founderCreateCompany: (adminUserId, name) => rpc(client, "founder_create_company", { p_admin_user: adminUserId, p_name: name }, S.companyIdSchema),
    founderUpdateSetting: (key, value) => rpc(client, "founder_update_setting", { p_key: key, p_value: value }, none),
  };
}

function authResult(error: { code?: string; status?: number; message?: string } | null): AuthResult {
  return error ? { ok: false, code: toAuthErrorCode(error) } : { ok: true };
}

export function createSupabaseAuthPort(client: Client): AuthPort {
  return {
    async getUser() {
      const { data, error } = await client.auth.getUser();
      if (error || !data.user) return null;
      const u = data.user;
      const meta = (u.user_metadata ?? {}) as Record<string, unknown>;
      return {
        id: u.id,
        email: u.email ?? null,
        emailConfirmed: Boolean(u.email_confirmed_at),
        fullName: typeof meta.full_name === "string" ? meta.full_name : null,
        pendingCompanyName: typeof meta.pending_company_name === "string" ? meta.pending_company_name : null,
      };
    },
    async signInWithPassword(email, password) {
      try {
        return authResult((await client.auth.signInWithPassword({ email, password })).error);
      } catch (e) {
        return authResult({ message: e instanceof Error ? e.message : String(e) });
      }
    },
    async signUp({ email, password, fullName, companyName, redirectTo }) {
      try {
        const { data, error } = await client.auth.signUp({
          email,
          password,
          // Descriptive values only: the database trigger copies nothing but full_name.
          options: { data: { full_name: fullName, pending_company_name: companyName }, emailRedirectTo: redirectTo },
        });
        if (error) return { ok: false, code: toAuthErrorCode(error) };
        return { ok: true, sessionStarted: Boolean(data.session) };
      } catch (e) {
        return { ok: false, code: toAuthErrorCode({ message: e instanceof Error ? e.message : String(e) }) };
      }
    },
    async signOut(scope = "local") {
      await client.auth.signOut({ scope });
    },
    async verifyPassword(email, password) {
      const { url, anonKey } = requireSupabaseConfig();
      // A separate client with no storage: checking a password must not alter the live session.
      const verifier = createStatelessClient(url, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      try {
        return authResult((await verifier.auth.signInWithPassword({ email, password })).error);
      } catch (e) {
        return authResult({ message: e instanceof Error ? e.message : String(e) });
      }
    },
    async updatePassword(newPassword) {
      try {
        return authResult((await client.auth.updateUser({ password: newPassword })).error);
      } catch (e) {
        return authResult({ message: e instanceof Error ? e.message : String(e) });
      }
    },
    async requestPasswordReset(email, redirectTo) {
      try {
        return authResult((await client.auth.resetPasswordForEmail(email, { redirectTo })).error);
      } catch (e) {
        return authResult({ message: e instanceof Error ? e.message : String(e) });
      }
    },
    async exchangeCode(code) {
      const { error } = await client.auth.exchangeCodeForSession(code);
      return !error;
    },
    async resendConfirmation(email, redirectTo) {
      try {
        return authResult((await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: redirectTo } })).error);
      } catch (e) {
        return authResult({ message: e instanceof Error ? e.message : String(e) });
      }
    },
  };
}

export function createSupabaseAuthAdminPort(): AuthAdminPort {
  return {
    async inviteUser({ email, fullName, redirectTo }) {
      try {
        const { data, error } = await createAdminClient().auth.admin.inviteUserByEmail(email, { data: { full_name: fullName }, redirectTo });
        if (error || !data.user) return { ok: false, code: toAuthErrorCode(error) };
        return { ok: true, userId: data.user.id };
      } catch (e) {
        return { ok: false, code: toAuthErrorCode({ message: e instanceof Error ? e.message : String(e) }) };
      }
    },
    async deleteUser(userId) {
      await createAdminClient().auth.admin.deleteUser(userId);
    },
  };
}

