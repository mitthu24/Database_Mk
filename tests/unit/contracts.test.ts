import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { mapDatabaseError } from "@/lib/backend/errors";
import { BackendError, type DataPort } from "@/lib/backend/port";
import * as S from "@/lib/backend/schemas";
import { createSupabaseDataPort } from "@/lib/backend/supabase-ports";
import type { SupabaseClient } from "@supabase/supabase-js";

const fixtureDir = join(__dirname, "../fixtures/contracts");
const fixture = (name: string): unknown => JSON.parse(readFileSync(join(fixtureDir, `${name}.json`), "utf8"));

describe("contract fixtures are REAL outputs of the SQL functions, parsed by the adapter's schemas", () => {
  it("has a fixture for every RPC family", () => {
    expect(readdirSync(fixtureDir).filter((f) => f.endsWith(".json")).length).toBeGreaterThanOrEqual(25);
  });

  it("get_my_context (admin, employee, founder, no company)", () => {
    const admin = S.contextSchema.parse(fixture("context_admin"));
    expect(admin).toMatchObject({ role: "admin", access: "full", isFounder: false });
    expect(S.contextSchema.parse(fixture("context_employee"))).toMatchObject({ role: "employee" });
    expect(S.contextSchema.parse(fixture("context_founder"))).toMatchObject({ isFounder: true, access: "none" });
    expect(S.contextSchema.parse(fixture("context_no_company"))).toMatchObject({ companyId: null, access: "none" });
  });

  it("tables, table, rows, row", () => {
    const tables = S.tableListSchema.parse(fixture("tables"));
    expect(tables.length).toBeGreaterThan(0);
    expect(tables[0].access.manage).toBe(true);
    expect(tables[0].columns[0]).toMatchObject({ key: expect.any(String), label: expect.any(String) });
    expect(S.tableSchema.parse(fixture("table")).rowCount).toBeGreaterThanOrEqual(0);
    const page = S.rowPageSchema.parse(fixture("rows"));
    expect(page.rows.length).toBeLessThanOrEqual(3);
    expect(page.total).toBeGreaterThanOrEqual(page.rows.length);
    expect(page.rows[0].data).toBeTypeOf("object");
    expect(S.rowRecordSchema.parse(fixture("row")).data.sku).toBe("CONTRACT-1");
  });

  it("import outcomes (success and failure) and job history", () => {
    expect(S.importOutcomeSchema.parse(fixture("import_ok"))).toMatchObject({ ok: true, inserted: 2, deleted: 0, mode: "append" });
    const bad = S.importOutcomeSchema.parse(fixture("import_failed"));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]).toMatchObject({ row: 2, message: expect.any(String) });
    const jobs = S.importJobsSchema.parse(fixture("import_jobs"));
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.some((j) => j.status === "failed" && j.errorCount > 0)).toBe(true);
  });

  it("company profile, members, permissions, audit, payments, settings", () => {
    expect(S.companyProfileSchema.parse(fixture("company_profile")).name).toBeTruthy();
    const members = S.memberListSchema.parse(fixture("members"));
    expect(members.some((m) => m.role === "admin")).toBe(true);
    expect(members.every((m) => typeof m.tablesWithAccess === "number")).toBe(true);
    expect(S.permissionListSchema.parse(fixture("permissions")).length).toBeGreaterThan(0);
    const audit = S.auditPageSchema.parse(fixture("company_audit"));
    expect(audit.total).toBeGreaterThan(0);
    expect(audit.rows[0].createdAt).toBeTruthy();
    expect(S.paymentListSchema.parse(fixture("payments")).length).toBeGreaterThan(0);
    expect(S.settingsSchema.parse(fixture("settings"))).toBeTypeOf("object");
  });

  it("founder views", () => {
    const o = S.founderOverviewSchema.parse(fixture("founder_overview"));
    expect(o.signupsByMonth).toHaveLength(6);
    expect(o.companiesTotal).toBeGreaterThan(0);
    const companies = S.founderCompanyPageSchema.parse(fixture("founder_companies"));
    expect(companies.rows[0]).toMatchObject({ access: expect.stringMatching(/full|read_only|suspended/) });
    const detail = S.founderCompanyDetailSchema.parse(fixture("founder_company_detail"));
    expect(detail.subscription.status).toBeTruthy();
    expect(S.memberListSchema.parse(fixture("founder_members")).length).toBeGreaterThan(0);
    expect(S.paymentPageSchema.parse(fixture("founder_payments")).rows[0].companyName).toBeTruthy();
    expect(S.auditPageSchema.parse(fixture("founder_audit")).rows[0].companyName).not.toBeUndefined();
    expect(S.paymentSchema.parse(fixture("founder_review")).status).toBe("rejected");
    expect(S.companyIdSchema.parse(fixture("founder_create_company"))).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects a response whose shape drifts", () => {
    const drifted = (fixture("tables") as Record<string, unknown>[]).map((t) => ({ ...t, row_count: "many" }));
    expect(S.tableListSchema.safeParse(drifted).success).toBe(false);
    expect(S.founderOverviewSchema.safeParse({ ...(fixture("founder_overview") as object), signups_by_month: null }).success).toBe(false);
  });
});

// ---- adapter <-> SQL signature check -------------------------------------------------------

interface SqlParam {
  name: string;
  hasDefault: boolean;
}

function readSqlSignatures(): Map<string, SqlParam[]> {
  const dir = join(__dirname, "../../supabase/migrations");
  const sigs = new Map<string, SqlParam[]>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = readFileSync(join(dir, f), "utf8");
    const re = /create (?:or replace )?function public\.([a-z_]+)\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql))) {
      let depth = 1;
      let i = re.lastIndex;
      const start = i;
      for (; i < sql.length && depth > 0; i++) {
        if (sql[i] === "(") depth++;
        else if (sql[i] === ")") depth--;
      }
      const inner = sql.slice(start, i - 1);
      const parts: string[] = [];
      let d = 0;
      let cur = "";
      for (const ch of inner) {
        if (ch === "(") d++;
        if (ch === ")") d--;
        if (ch === "," && d === 0) {
          parts.push(cur);
          cur = "";
        } else cur += ch;
      }
      if (cur.trim()) parts.push(cur);
      sigs.set(
        m[1],
        parts
          .map((p) => p.trim().replace(/\s+/g, " "))
          .filter(Boolean)
          .map((p) => ({ name: p.split(" ")[0], hasDefault: /\bdefault\b/i.test(p) })),
      );
    }
  }
  return sigs;
}

function fakeClient(responder: (fn: string) => { data: unknown; error?: { code?: string; message?: string } | null }) {
  const calls: { fn: string; args: Record<string, unknown> | undefined }[] = [];
  const client = {
    rpc: async (fn: string, args?: Record<string, unknown>) => {
      calls.push({ fn, args });
      const r = responder(fn);
      return { data: r.data, error: r.error ?? null, status: r.error ? 400 : 200 };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const fixtureForFn: Record<string, unknown> = {
  get_my_context: fixture("context_admin"),
  get_company_profile: fixture("company_profile"),
  update_company_profile: fixture("company_profile"),
  update_my_profile: null,
  register_company: "11111111-1111-4111-8111-111111111111",
  list_tables: fixture("tables"),
  get_table: fixture("table"),
  create_logical_table: fixture("table"),
  rename_logical_table: fixture("table"),
  update_table_schema: fixture("table"),
  clear_table_rows: 3,
  drop_logical_table: null,
  query_rows: fixture("rows"),
  insert_row: fixture("row"),
  update_row: fixture("row"),
  delete_rows: 2,
  import_rows: fixture("import_ok"),
  list_import_jobs: fixture("import_jobs"),
  authorize_export: null,
  list_members: fixture("members"),
  add_company_member: (fixture("members") as unknown[])[0],
  set_member_status: (fixture("members") as unknown[])[0],
  set_member_role: (fixture("members") as unknown[])[0],
  set_member_code: (fixture("members") as unknown[])[0],
  list_permissions: fixture("permissions"),
  set_table_permission: null,
  list_company_audit: fixture("company_audit"),
  list_payments: fixture("payments"),
  submit_manual_payment: (fixture("payments") as unknown[])[0],
  get_platform_settings: fixture("settings"),
  founder_overview: fixture("founder_overview"),
  founder_list_companies: fixture("founder_companies"),
  founder_company_detail: fixture("founder_company_detail"),
  founder_list_members: fixture("founder_members"),
  founder_list_payments: fixture("founder_payments"),
  founder_review_payment: fixture("founder_review"),
  founder_audit: fixture("founder_audit"),
  founder_set_company_status: null,
  founder_set_subscription: null,
  founder_create_company: fixture("founder_create_company"),
  founder_update_setting: null,
};

const ID = "22222222-2222-4222-8222-222222222222";
const calls: [string, (p: DataPort) => Promise<unknown>][] = [
  ["getContext", (p) => p.getContext()],
  ["getCompanyProfile", (p) => p.getCompanyProfile()],
  ["updateCompanyProfile", (p) => p.updateCompanyProfile({ name: "A", contactEmail: "", phone: "", address: "" })],
  ["updateMyProfile", (p) => p.updateMyProfile("N")],
  ["registerCompany", (p) => p.registerCompany("Co")],
  ["listTables", (p) => p.listTables()],
  ["getTable", (p) => p.getTable(ID)],
  ["createTable", (p) => p.createTable("T", [])],
  ["renameTable", (p) => p.renameTable(ID, "T2")],
  ["updateTableSchema", (p) => p.updateTableSchema(ID, [])],
  ["clearTable", (p) => p.clearTable(ID)],
  ["dropTable", (p) => p.dropTable(ID)],
  ["queryRows", (p) => p.queryRows(ID, { search: "x", filters: [{ key: "a", op: "eq", value: "1" }], sortKey: "a", sortDir: "desc", offset: 5, limit: 10 })],
  ["queryRows (defaults)", (p) => p.queryRows(ID)],
  ["insertRow", (p) => p.insertRow(ID, { a: 1 })],
  ["updateRow", (p) => p.updateRow(ID, ID, { a: 1 })],
  ["deleteRows", (p) => p.deleteRows(ID, [ID])],
  ["importRows", (p) => p.importRows(ID, "append", [{ a: 1 }], "f.csv")],
  ["listImportJobs", (p) => p.listImportJobs(ID, 10)],
  ["listImportJobs (all)", (p) => p.listImportJobs()],
  ["authorizeExport", (p) => p.authorizeExport(ID)],
  ["listMembers", (p) => p.listMembers()],
  ["addMember", (p) => p.addMember(ID, "EMP-1")],
  ["addMember (auto code)", (p) => p.addMember(ID)],
  ["setMemberStatus", (p) => p.setMemberStatus(ID, "disabled")],
  ["setMemberRole", (p) => p.setMemberRole(ID, "admin")],
  ["setMemberCode", (p) => p.setMemberCode(ID, "X")],
  ["listPermissions", (p) => p.listPermissions(ID)],
  ["setTablePermission", (p) => p.setTablePermission(ID, ID, { view: true, create: false, edit: true, delete: false, import: false, export: true })],
  ["listCompanyAudit", (p) => p.listCompanyAudit({ action: "member.", limit: 5, offset: 0 })],
  ["listPayments", (p) => p.listPayments()],
  ["submitPayment", (p) => p.submitPayment({ amount: 5, currency: "USD", months: 1, method: "Bank", reference: "REF-1", note: "" })],
  ["getPlatformSettings", (p) => p.getPlatformSettings()],
  ["founderOverview", (p) => p.founderOverview()],
  ["founderListCompanies", (p) => p.founderListCompanies({ search: "a", state: "trialing", limit: 5, offset: 0 })],
  ["founderCompanyDetail", (p) => p.founderCompanyDetail(ID)],
  ["founderListMembers", (p) => p.founderListMembers(ID)],
  ["founderListPayments", (p) => p.founderListPayments("pending", 5, 0)],
  ["founderReviewPayment", (p) => p.founderReviewPayment(ID, "approve", "ok")],
  ["founderAudit", (p) => p.founderAudit({ companyId: ID, action: "x", limit: 5, offset: 0 })],
  ["founderSetCompanyStatus", (p) => p.founderSetCompanyStatus(ID, "suspended", "why")],
  ["founderSetSubscription", (p) => p.founderSetSubscription(ID, { status: "trialing", trialEndsAt: "2026-12-01T00:00:00Z" })],
  ["founderCreateCompany", (p) => p.founderCreateCompany(ID, "Co")],
  ["founderUpdateSetting", (p) => p.founderUpdateSetting("support_email", "x@example.com")],
];

describe("Supabase data port <-> SQL function signatures", () => {
  const sigs = readSqlSignatures();

  it("parses a sensible number of public functions from the migrations", () => {
    expect(sigs.size).toBeGreaterThan(40);
    expect(sigs.get("query_rows")?.map((p) => p.name)).toEqual(["p_table", "p_search", "p_filters", "p_sort_key", "p_sort_dir", "p_offset", "p_limit"]);
    expect(sigs.get("get_my_context")).toEqual([]);
  });

  it.each(calls)("%s calls an existing RPC with valid argument names and parses the result", async (_label, invoke) => {
    const { client, calls: recorded } = fakeClient((fn) => ({ data: fixtureForFn[fn] }));
    await invoke(createSupabaseDataPort(client));
    expect(recorded).toHaveLength(1);
    const { fn, args } = recorded[0];
    const sig = sigs.get(fn);
    expect(sig, `function public.${fn} does not exist in the migrations`).toBeDefined();

    const sent = Object.keys(args ?? {});
    const known = new Set(sig!.map((p) => p.name));
    for (const k of sent) expect(known.has(k), `${fn}: adapter sends unknown parameter ${k}`).toBe(true);
    for (const p of sig!.filter((x) => !x.hasDefault)) {
      expect(sent.includes(p.name), `${fn}: adapter omits required parameter ${p.name}`).toBe(true);
    }
  });

  it("covers every public RPC the application is meant to call", () => {
    const used = new Set<string>();
    // gather by actually running every call once
    const { client, calls: recorded } = fakeClient((fn) => ({ data: fixtureForFn[fn] }));
    const port = createSupabaseDataPort(client);
    return Promise.all(calls.map(([, invoke]) => invoke(port))).then(() => {
      recorded.forEach((r) => used.add(r.fn));
      // Functions deliberately NOT called by the app (internal helpers or exercised elsewhere).
      const notCalledByApp = new Set(["founder_set_subscription_unused"]);
      const missing = [...sigs.keys()].filter((fn) => !used.has(fn) && !notCalledByApp.has(fn));
      expect(missing, `RPCs defined in SQL but never called by the adapter: ${missing.join(", ")}`).toEqual([]);
    });
  });
});

describe("Supabase data port error handling", () => {
  const run = async (error: { code?: string; message?: string }) => {
    const { client } = fakeClient(() => ({ data: null, error }));
    return createSupabaseDataPort(client).listTables().catch((e) => e);
  };

  it.each([
    [{ code: "42501", message: "not authorized" }, "forbidden"],
    [{ code: "P0002", message: "table not found" }, "not_found"],
    [{ code: "23505", message: 'duplicate key value violates unique constraint "table_metadata_company_name_key"' }, "conflict"],
    [{ code: "23514", message: "row validation failed: SKU is required" }, "invalid"],
    [{ code: "22023", message: "invalid columns: duplicate column key \"a\"" }, "invalid"],
    [{ code: "53400", message: "a company can have at most 100 tables" }, "limit"],
    [{ code: "XX000", message: "internal: relation foo secret detail" }, "unknown"],
    [{ message: "TypeError: fetch failed" }, "unavailable"],
    [{ code: "PGRST301", message: "JWT expired" }, "forbidden"],
  ])("maps %j to %s", async (err, kind) => {
    const e = await run(err);
    expect(e).toBeInstanceOf(BackendError);
    expect((e as BackendError).kind).toBe(kind);
  });

  it("never leaks internal error text for unknown errors", async () => {
    const e = (await run({ code: "XX000", message: "internal: relation foo secret detail" })) as BackendError;
    expect(e.message).not.toMatch(/secret|relation foo/);
  });

  it("translates raw constraint violations into friendly messages and strips internal prefixes", () => {
    expect(mapDatabaseError({ code: "23505", message: 'duplicate key value violates unique constraint "manual_payments_company_reference_key"' }).message)
      .toBe("That payment reference was already submitted.");
    expect(mapDatabaseError({ code: "23514", message: 'new row for relation "manual_payments" violates check constraint "manual_payments_months_range"' }).message)
      .toBe("Choose between 1 and 36 months.");
    expect(mapDatabaseError({ code: "23514", message: "row validation failed: Quantity must be a whole number" }).message)
      .toBe("Quantity must be a whole number");
    expect(mapDatabaseError({ code: "22023", message: "invalid columns: duplicate column key \"a\"" }).message)
      .toBe('duplicate column key "a"');
  });

  it("reports an unexpected response shape instead of passing it on", async () => {
    const { client } = fakeClient(() => ({ data: [{ id: 1, bogus: true }] }));
    const e = await createSupabaseDataPort(client).listTables().catch((x) => x);
    expect(e).toBeInstanceOf(BackendError);
    expect((e as BackendError).code).toBe("bad_shape");
  });

  it("turns a thrown network failure into an 'unavailable' error", async () => {
    const client = { rpc: async () => { throw new Error("fetch failed"); } } as unknown as SupabaseClient;
    const e = await createSupabaseDataPort(client).listTables().catch((x) => x);
    expect((e as BackendError).kind).toBe("unavailable");
  });
});
