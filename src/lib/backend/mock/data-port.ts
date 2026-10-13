// DEVELOPMENT / TEST ONLY — see store.ts. Mirrors the SQL functions in
// supabase/migrations/ (entitlement, suspension, permissions, atomic import,
// payment approval, error messages). The SQL is the authority.

import type { AppContext } from "@/lib/auth/context";
import {
  BackendError,
  type BackendErrorKind,
  type DataPort,
} from "@/lib/backend/port";
import type {
  AuditEvent,
  AuditQuery,
  CompanyAccess,
  CompanyProfile,
  FounderCompanyDetail,
  FounderCompanyQuery,
  FounderCompanyRow,
  FounderOverview,
  Member,
  Page,
  Payment,
  PaymentInput,
  PaymentStatus,
  PermissionFlags,
  PlatformSettings,
  SettingKey,
  TablePermission,
} from "@/lib/backend/types";
import {
  newId,
  type MAudit,
  type MMember,
  type MockStore,
  type MPayment,
  type MRow,
  type MSub,
  type MTable,
} from "@/lib/backend/mock/store";
import { rowError, validateColumns } from "@/lib/data/row-validation";
import type {
  ColumnDef,
  ImportJob,
  ImportMode,
  ImportOutcome,
  RowData,
  RowPage,
  RowQuery,
  RowRecord,
  TableAccess,
  TableSummary,
} from "@/lib/data/types";
import { FILTER_OPS } from "@/lib/data/types";

const DAY = 86_400_000;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

function fail(kind: BackendErrorKind, message: string): never {
  throw new BackendError(kind, message);
}
const forbidden = () => fail("forbidden", "You do not have permission to do that.");
const notFound = () => fail("not_found", "That item no longer exists.");
const invalid = (m: string) => fail("invalid", m);

function addMonths(d: Date, months: number): Date {
  const r = new Date(d.getTime());
  r.setUTCMonth(r.getUTCMonth() + months);
  return r;
}

function tryNumber(s: string | null | undefined): number | null {
  if (s === null || s === undefined) return null;
  const t = s.trim();
  return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t) ? Number(t) : null;
}

function matchFilter(data: RowData, key: string, op: string, value: string | undefined): boolean {
  const v = data[key];
  const s = v === undefined || v === null ? null : String(v);
  const a = tryNumber(s);
  const b = tryNumber(value);
  if (op === "empty") return s === null || s === "";
  if (op === "notempty") return s !== null && s !== "";
  if (op === "contains") return s !== null && s.toLowerCase().includes((value ?? "").toLowerCase());
  if (op === "eq" || op === "neq") {
    if (s === null) return op === "neq";
    return (a !== null && b !== null ? a === b : s === value) === (op === "eq");
  }
  if (op === "gt" || op === "gte" || op === "lt" || op === "lte") {
    if (s === null) return false;
    const cmp = a !== null && b !== null ? Math.sign(a - b) : s < (value ?? "") ? -1 : s > (value ?? "") ? 1 : 0;
    return op === "gt" ? cmp > 0 : op === "gte" ? cmp >= 0 : op === "lt" ? cmp < 0 : cmp <= 0;
  }
  return invalid("unknown filter operator");
}

const TYPE_RANK = (v: unknown) => (typeof v === "string" ? 1 : typeof v === "number" ? 2 : 3);
function compareValues(x: unknown, y: unknown): number {
  const rx = TYPE_RANK(x);
  const ry = TYPE_RANK(y);
  if (rx !== ry) return rx - ry;
  if (typeof x === "number" && typeof y === "number") return x - y;
  if (typeof x === "string" && typeof y === "string") return x.localeCompare(y, "en");
  return Number(x) - Number(y);
}

export function createMockDataPort(store: MockStore, userId: string | null): DataPort {
  const now = () => new Date();
  const me = () => (userId ? store.users.get(userId) ?? null : null);
  const requireUser = () => {
    const u = me();
    if (!u) forbidden();
    return u!;
  };
  const audit = (companyId: string | null, action: string, targetType: string | null, targetId: string | null, metadata: Record<string, unknown> = {}, actorId: string | null = userId) => {
    const a: MAudit = { id: ++store.seq.audit, companyId, actorId, action, targetType, targetId, metadata, createdAt: now() };
    store.audit.push(a);
  };

  // ---- predicates (mirror private.* helpers) --------------------------------------------
  const membership = (): MMember | undefined => store.members.find((m) => m.userId === userId && m.status === "active");
  const myCompany = () => membership()?.companyId ?? null;
  const myAdminCompany = () => {
    const m = membership();
    return m && m.role === "admin" ? m.companyId : null;
  };
  const isFounder = () => Boolean(me()?.isFounder);
  const isAdminOf = (companyId: string) => store.members.some((m) => m.userId === userId && m.companyId === companyId && m.status === "active" && m.role === "admin");
  const entitled = (s: MSub | undefined) =>
    Boolean(s && ((s.status === "trialing" && s.trialEndsAt > now()) || (s.status === "active" && (s.currentPeriodEnd === null || s.currentPeriodEnd > now()))));
  const canRead = (companyId: string) => store.companies.get(companyId)?.status === "active";
  const canWrite = (companyId: string) => canRead(companyId) && entitled(store.subs.get(companyId));
  const companyAccess = (companyId: string): CompanyAccess => (!canRead(companyId) ? "suspended" : canWrite(companyId) ? "full" : "read_only");

  type PermKey = "view" | "create" | "edit" | "delete" | "import" | "export";
  const hasPerm = (tableId: string, key: PermKey) => {
    const t = store.tables.get(tableId);
    if (!t) return false;
    const m = store.members.find((x) => x.userId === userId && x.companyId === t.companyId && x.status === "active");
    return Boolean(m && store.perms.some((p) => p.userId === userId && p.tableId === tableId && p[key]));
  };
  /** private.accessible_table_ids */
  const accessibleIds = (perm: PermKey, write: boolean): Set<string> => {
    const m = membership();
    const out = new Set<string>();
    if (!m || !(write ? canWrite(m.companyId) : canRead(m.companyId))) return out;
    for (const t of store.tables.values()) {
      if (t.companyId !== m.companyId) continue;
      if (m.role === "admin" || hasPerm(t.id, perm)) out.add(t.id);
    }
    return out;
  };
  const visibleTable = (id: string): MTable | undefined => {
    const t = store.tables.get(id);
    if (!t || !canRead(t.companyId)) return undefined;
    return isAdminOf(t.companyId) || hasPerm(id, "view") ? t : undefined;
  };
  const adminTable = (id: string): { t: MTable; companyId: string } => {
    const companyId = myAdminCompany();
    const t = store.tables.get(id);
    if (!userId || !companyId || !t || t.companyId !== companyId || !canWrite(companyId)) forbidden();
    return { t: t!, companyId: companyId! };
  };
  const adminWritable = (): string => {
    const companyId = myAdminCompany();
    if (!userId || !companyId || !canWrite(companyId)) forbidden();
    return companyId!;
  };

  const tableAccess = (t: MTable): TableAccess =>
    isAdminOf(t.companyId)
      ? { view: true, create: true, edit: true, delete: true, import: true, export: true, manage: true }
      : { view: hasPerm(t.id, "view"), create: hasPerm(t.id, "create"), edit: hasPerm(t.id, "edit"), delete: hasPerm(t.id, "delete"), import: hasPerm(t.id, "import"), export: hasPerm(t.id, "export"), manage: false };
  const rowsOf = (tableId: string) => store.rows.get(tableId) ?? [];
  const toSummary = (t: MTable): TableSummary => ({
    id: t.id,
    name: t.name,
    columns: t.columns.map((c) => ({ ...c })),
    rowCount: rowsOf(t.id).length,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    dataUpdatedAt: t.dataUpdatedAt.toISOString(),
    access: tableAccess(t),
  });
  const toRecord = (r: MRow): RowRecord => ({ id: r.id, rowOrder: r.rowOrder, data: { ...r.data }, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() });

  const memberJson = (m: MMember): Member => {
    const u = store.users.get(m.userId);
    return {
      id: m.id,
      userId: m.userId,
      role: m.role,
      status: m.status,
      employeeCode: m.employeeCode,
      createdAt: m.createdAt.toISOString(),
      email: u?.email ?? null,
      fullName: u?.fullName ?? null,
      tablesWithAccess: store.perms.filter((p) => p.companyId === m.companyId && p.userId === m.userId && p.view).length,
    };
  };
  const paymentJson = (p: MPayment, extras = false): Payment => ({
    id: p.id,
    companyId: p.companyId,
    amount: p.amount,
    currency: p.currency,
    months: p.months,
    method: p.method,
    reference: p.reference,
    note: p.note,
    status: p.status,
    reviewNote: p.reviewNote,
    reviewedAt: iso(p.reviewedAt),
    createdAt: p.createdAt.toISOString(),
    companyName: extras ? store.companies.get(p.companyId)?.name ?? null : null,
    submittedByEmail: extras ? store.users.get(p.submittedBy)?.email ?? null : null,
  });
  const auditJson = (a: MAudit, withCompany: boolean): AuditEvent => ({
    id: a.id,
    createdAt: a.createdAt.toISOString(),
    action: a.action,
    targetType: a.targetType,
    targetId: a.targetId,
    metadata: a.metadata,
    actorId: a.actorId,
    actorEmail: a.actorId ? store.users.get(a.actorId)?.email ?? null : null,
    companyId: withCompany ? a.companyId : null,
    companyName: withCompany && a.companyId ? store.companies.get(a.companyId)?.name ?? null : null,
  });
  const requireFounder = () => {
    requireUser();
    if (!isFounder()) forbidden();
  };
  const page = <T,>(items: T[], offset: number, limit: number): T[] => items.slice(Math.max(offset, 0), Math.max(offset, 0) + limit);
  const clamp = (n: number | undefined, def: number, lo: number, hi: number) => Math.min(Math.max(n ?? def, lo), hi);
  const nameOk = (name: string, lo: number, what: string) => {
    const n = name.replace(/^ +| +$/g, "");
    const len = Array.from(n).length;
    if (len < lo || len > 120) invalid(`${what} must be ${lo === 1 ? "1" : lo}-120 characters`);
    return n;
  };

  const port: DataPort = {
    // ---- context & profile ---------------------------------------------------------------
    async getContext(): Promise<AppContext | null> {
      const u = me();
      if (!u) return null;
      const m = store.members.find((x) => x.userId === u.id);
      const c = m ? store.companies.get(m.companyId) : undefined;
      const s = m ? store.subs.get(m.companyId) : undefined;
      return {
        userId: u.id,
        isFounder: u.isFounder,
        companyId: c?.id ?? null,
        companyName: c?.name ?? null,
        companyStatus: c?.status ?? null,
        role: m?.role ?? null,
        memberStatus: m?.status ?? null,
        plan: s?.plan ?? null,
        subscriptionStatus: s?.status ?? null,
        trialEndsAt: s?.trialEndsAt ?? null,
        currentPeriodEnd: s?.currentPeriodEnd ?? null,
        access: !c || !m ? "none" : m.status !== "active" ? "disabled" : c.status !== "active" ? "suspended" : canWrite(c.id) ? "full" : "read_only",
      };
    },
    async getCompanyProfile(): Promise<CompanyProfile | null> {
      const id = myCompany();
      const c = id ? store.companies.get(id) : undefined;
      return c ? { id: c.id, name: c.name, status: c.status, contactEmail: c.contactEmail, phone: c.phone, address: c.address, createdAt: c.createdAt.toISOString() } : null;
    },
    async updateCompanyProfile(i) {
      const companyId = adminWritable();
      const name = nameOk(i.name, 2, "company name");
      const email = i.contactEmail.trim();
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) invalid("contact email is not valid");
      if (email.length > 254) invalid("The contact email is too long.");
      if (i.phone.length > 40) invalid("The phone number is too long.");
      if (i.address.length > 500) invalid("The address is too long.");
      const c = store.companies.get(companyId)!;
      Object.assign(c, { name, contactEmail: email || null, phone: i.phone.trim() || null, address: i.address.trim() || null });
      audit(companyId, "company.profile_updated", "company", companyId);
      return (await port.getCompanyProfile())!;
    },
    async updateMyProfile(fullName) {
      const u = requireUser();
      const n = fullName.replace(/^ +| +$/g, "");
      if (Array.from(n).length < 1 || Array.from(n).length > 120) invalid("name must be 1-120 characters");
      u.fullName = n;
    },
    async registerCompany(name) {
      const u = requireUser();
      const n = nameOk(name, 2, "company name");
      if (!u.emailConfirmed) forbidden();
      if (u.isFounder) forbidden();
      if (store.members.some((m) => m.userId === u.id)) fail("conflict", "That already exists.");
      const id = newId(store);
      store.companies.set(id, { id, name: n, status: "active", contactEmail: null, phone: null, address: null, createdAt: now() });
      store.members.push({ id: newId(store), companyId: id, userId: u.id, role: "admin", status: "active", employeeCode: null, createdAt: now() });
      store.subs.set(id, { companyId: id, plan: "trial", status: "trialing", trialStartedAt: now(), trialEndsAt: new Date(now().getTime() + 30 * DAY), currentPeriodEnd: null });
      audit(id, "company.registered", "company", id, { name: n });
      return id;
    },

    // ---- logical tables --------------------------------------------------------------------
    async listTables() {
      return [...store.tables.values()]
        .filter((t) => visibleTable(t.id))
        .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
        .map(toSummary);
    },
    async getTable(id) {
      const t = visibleTable(id);
      return t ? toSummary(t) : null;
    },
    async createTable(name, columns) {
      const companyId = adminWritable();
      const n = nameOk(name, 1, "table name");
      const err = validateColumns(columns);
      if (err) invalid(err);
      if ([...store.tables.values()].filter((t) => t.companyId === companyId).length >= 100) fail("limit", "a company can have at most 100 tables");
      if ([...store.tables.values()].some((t) => t.companyId === companyId && t.name.toLowerCase() === n.toLowerCase())) fail("conflict", "A table with that name already exists.");
      const t: MTable = { id: newId(store), companyId, name: n, columns: columns.map((c) => ({ ...c })), createdAt: now(), updatedAt: now(), dataUpdatedAt: now() };
      store.tables.set(t.id, t);
      store.rows.set(t.id, []);
      audit(companyId, "table.created", "table", t.id, { name: n, columns: columns.length });
      return toSummary(t);
    },
    async renameTable(id, name) {
      const { t, companyId } = adminTable(id);
      const n = nameOk(name, 1, "table name");
      if ([...store.tables.values()].some((x) => x.id !== id && x.companyId === companyId && x.name.toLowerCase() === n.toLowerCase())) fail("conflict", "A table with that name already exists.");
      const old = t.name;
      t.name = n;
      t.updatedAt = now();
      audit(companyId, "table.renamed", "table", id, { from: old, to: n });
      return toSummary(t);
    },
    async updateTableSchema(id, columns) {
      const { t, companyId } = adminTable(id);
      const err = validateColumns(columns);
      if (err) invalid(err);
      const rows = rowsOf(id);
      const before = new Map(t.columns.map((c) => [c.key, c]));
      let added = 0;
      let retyped = 0;
      for (const c of columns) {
        const o = before.get(c.key);
        if (!o) {
          added++;
          if (c.required && rows.length > 0) fail("invalid", `cannot add required column "${c.label}" to a table that already has rows`);
        } else {
          if (o.type !== c.type) {
            retyped++;
            const probe: ColumnDef[] = [{ key: c.key, label: c.label, type: c.type }];
            if (rows.some((r) => r.data[c.key] !== undefined && r.data[c.key] !== null && rowError(probe, { [c.key]: r.data[c.key] }) !== null)) {
              fail("invalid", `existing values do not fit the new type of "${c.label}"`);
            }
          }
          if (c.required && !o.required && rows.some((r) => r.data[c.key] === undefined || r.data[c.key] === null || r.data[c.key] === "")) {
            fail("invalid", `column "${c.label}" has empty values, so it cannot be required`);
          }
        }
      }
      const kept = new Set(columns.map((c) => c.key));
      const removed = t.columns.filter((c) => !kept.has(c.key)).map((c) => c.key);
      for (const r of rows) for (const k of removed) delete r.data[k];
      t.columns = columns.map((c) => ({ ...c }));
      t.updatedAt = now();
      audit(companyId, "table.schema_updated", "table", id, { added, removed: removed.length, retyped });
      return toSummary(t);
    },
    async clearTable(id) {
      const { t, companyId } = adminTable(id);
      const n = rowsOf(id).length;
      store.rows.set(id, []);
      t.dataUpdatedAt = now();
      audit(companyId, "table.cleared", "table", id, { name: t.name, rows_deleted: n });
      return n;
    },
    async dropTable(id) {
      const { t, companyId } = adminTable(id);
      const n = rowsOf(id).length;
      store.tables.delete(id);
      store.rows.delete(id);
      store.perms = store.perms.filter((p) => p.tableId !== id);
      audit(companyId, "table.dropped", "table", id, { name: t.name, rows_deleted: n });
    },

    // ---- rows ------------------------------------------------------------------------------
    async queryRows(tableId, q: RowQuery = {}): Promise<RowPage> {
      const filters = q.filters ?? [];
      if (!Array.isArray(filters) || filters.length > 20) invalid("filters must be a list of at most 20 conditions");
      if (q.sortKey !== undefined && q.sortKey !== null && !/^[a-z][a-z0-9_]{0,39}$/.test(q.sortKey)) invalid("invalid sort column");
      const dir = (q.sortDir ?? "asc").toLowerCase();
      if (dir !== "asc" && dir !== "desc") invalid("invalid sort direction");
      for (const f of filters) if (!(FILTER_OPS as readonly string[]).includes(f.op)) invalid("unknown filter operator");
      const limit = clamp(q.limit, 50, 1, 500);
      const offset = Math.max(q.offset ?? 0, 0);

      const visible = accessibleIds("view", false).has(tableId);
      let rows = visible ? [...rowsOf(tableId)] : [];
      const search = q.search?.replace(/^ +| +$/g, "");
      if (search) {
        const needle = search.toLowerCase();
        rows = rows.filter((r) => Object.values(r.data).some((v) => v !== null && String(v).toLowerCase().includes(needle)));
      }
      rows = rows.filter((r) => filters.every((f) => matchFilter(r.data, f.key, f.op, f.value)));
      const key = q.sortKey ?? null;
      rows.sort((a, b) => {
        if (key) {
          const x = a.data[key] ?? null;
          const y = b.data[key] ?? null;
          if (x === null && y !== null) return 1; // missing / null always last
          if (y === null && x !== null) return -1;
          if (x !== null && y !== null) {
            const c = compareValues(x, y);
            if (c !== 0) return dir === "asc" ? c : -c;
          }
        }
        return a.rowOrder - b.rowOrder;
      });
      return { total: rows.length, offset, limit, rows: page(rows, offset, limit).map(toRecord) };
    },
    async insertRow(tableId, data) {
      const t = visibleTable(tableId);
      if (!t) fail("not_found", "That item no longer exists.");
      if (!accessibleIds("create", true).has(tableId)) forbidden();
      const err = rowError(t!.columns, data);
      if (err) invalid(err);
      const r: MRow = { id: newId(store), tableId, companyId: t!.companyId, rowOrder: ++store.seq.row, data: { ...data }, createdAt: now(), updatedAt: now() };
      rowsOf(tableId).push(r);
      t!.dataUpdatedAt = now();
      return toRecord(r);
    },
    async updateRow(tableId, rowId, data) {
      const t = store.tables.get(tableId);
      const r = rowsOf(tableId).find((x) => x.id === rowId);
      if (!t || !r || !accessibleIds("edit", true).has(tableId) || !visibleTable(tableId)) notFound();
      const err = rowError(t!.columns, data);
      if (err) invalid(err);
      r!.data = { ...data };
      r!.updatedAt = now();
      t!.dataUpdatedAt = now();
      return toRecord(r!);
    },
    async deleteRows(tableId, rowIds) {
      if (rowIds.length === 0 || rowIds.length > 1000) invalid("select between 1 and 1000 rows");
      if (!accessibleIds("delete", true).has(tableId) || !visibleTable(tableId)) return 0;
      const ids = new Set(rowIds);
      const before = rowsOf(tableId);
      const kept = before.filter((r) => !ids.has(r.id));
      store.rows.set(tableId, kept);
      if (kept.length !== before.length) store.tables.get(tableId)!.dataUpdatedAt = now();
      return before.length - kept.length;
    },

    // ---- import / export ---------------------------------------------------------------------
    async importRows(tableId, mode: ImportMode, rows, fileName): Promise<ImportOutcome> {
      const t = store.tables.get(tableId);
      const u = requireUser();
      if (!t || !canWrite(t.companyId)) forbidden();
      if (mode !== "append" && mode !== "replace") invalid("mode must be append or replace");
      const admin = isAdminOf(t!.companyId);
      if (!(mode === "replace" ? admin : admin || accessibleIds("import", true).has(tableId))) forbidden();
      if (!Array.isArray(rows)) invalid("rows must be a list");

      const MAX = 50_000;
      const MAX_TABLE = 200_000;
      const errors: { row: number; message: string }[] = [];
      let errorCount = 0;
      if (rows.length === 0) {
        errors.push({ row: 0, message: "the file contains no data rows" });
        errorCount = 1;
      } else if (rows.length > MAX) {
        errors.push({ row: 0, message: `too many rows (maximum ${MAX} per import)` });
        errorCount = 1;
      } else if (mode === "append" && rowsOf(tableId).length + rows.length > MAX_TABLE) {
        errors.push({ row: 0, message: `the table would exceed ${MAX_TABLE} rows` });
        errorCount = 1;
      } else {
        rows.forEach((r, i) => {
          const e = rowError(t!.columns, r);
          if (e) {
            errorCount++;
            if (errorCount <= 20) errors.push({ row: i + 1, message: e });
          }
        });
      }

      const job = (status: "succeeded" | "failed", extra: { inserted?: number; deleted?: number }) => {
        const j = {
          id: newId(store), companyId: t!.companyId, tableId, tableName: t!.name, mode, fileName: fileName?.slice(0, 255) ?? null, status,
          rowsReceived: Array.isArray(rows) ? rows.length : 0, rowsInserted: extra.inserted ?? 0, rowsDeleted: extra.deleted ?? 0,
          errors: status === "failed" ? errors : [], errorCount: status === "failed" ? errorCount : 0, createdBy: u.id, createdAt: now(),
        };
        store.jobs.push(j);
        return j;
      };

      if (errorCount > 0) {
        const j = job("failed", {});
        audit(t!.companyId, "import.failed", "table", tableId, { mode, rows: rows.length, error_count: errorCount });
        return { ok: false, jobId: j.id, errorCount, errors };
      }
      // Everything validated: build the new row set first, swap in one step (atomic).
      const deleted = mode === "replace" ? rowsOf(tableId).length : 0;
      const created: MRow[] = rows.map((r) => ({ id: newId(store), tableId, companyId: t!.companyId, rowOrder: ++store.seq.row, data: { ...r }, createdAt: now(), updatedAt: now() }));
      store.rows.set(tableId, mode === "replace" ? created : [...rowsOf(tableId), ...created]);
      t!.dataUpdatedAt = now();
      const j = job("succeeded", { inserted: created.length, deleted });
      audit(t!.companyId, `import.${mode}`, "table", tableId, { rows_inserted: created.length, rows_deleted: deleted, file: fileName });
      return { ok: true, jobId: j.id, mode, inserted: created.length, deleted };
    },
    async listImportJobs(tableId, limit): Promise<ImportJob[]> {
      const u = requireUser();
      const companyId = myCompany();
      return store.jobs
        .filter((j) => j.companyId === companyId && (isAdminOf(j.companyId) || j.createdBy === u.id) && (!tableId || j.tableId === tableId))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, clamp(limit, 50, 1, 200))
        .map((j) => ({
          id: j.id, tableId: j.tableId, tableName: j.tableName, mode: j.mode, fileName: j.fileName, status: j.status, rowsReceived: j.rowsReceived,
          rowsInserted: j.rowsInserted, rowsDeleted: j.rowsDeleted, errorCount: j.errorCount, errors: j.errors, createdBy: j.createdBy, createdAt: j.createdAt.toISOString(),
        }));
    },
    async authorizeExport(tableId) {
      requireUser();
      const t = store.tables.get(tableId);
      if (!t || !canRead(t.companyId) || !(isAdminOf(t.companyId) || hasPerm(tableId, "export"))) forbidden();
      audit(t!.companyId, "data.export_authorized", "table", tableId);
    },

    // ---- members & permissions ------------------------------------------------------------------------
    async listMembers() {
      requireUser();
      const companyId = myCompany();
      return store.members
        .filter((m) => m.userId === userId || (companyId && m.companyId === companyId && isAdminOf(companyId)))
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map(memberJson);
    },
    async addMember(uid, code) {
      const companyId = adminWritable();
      const u = store.users.get(uid);
      if (!u) notFound();
      if (u!.isFounder || store.members.some((m) => m.userId === uid)) fail("conflict", "That already exists.");
      if (store.members.filter((m) => m.companyId === companyId).length >= 500) fail("limit", "a company can have at most 500 members");
      const wanted = code?.trim();
      const used = store.members.filter((m) => m.companyId === companyId && m.employeeCode).map((m) => m.employeeCode!.toLowerCase());
      const next = Math.max(0, ...store.members.filter((m) => m.companyId === companyId).map((m) => Number(/^EMP-(\d+)$/.exec(m.employeeCode ?? "")?.[1] ?? 0))) + 1;
      const employeeCode = wanted || `EMP-${String(next).padStart(4, "0")}`;
      if (used.includes(employeeCode.toLowerCase())) fail("conflict", "That employee code is already used in your company.");
      const m: MMember = { id: newId(store), companyId, userId: uid, role: "employee", status: "active", employeeCode, createdAt: now() };
      store.members.push(m);
      audit(companyId, "member.added", "user", uid, { employee_code: employeeCode });
      return memberJson(m);
    },
    async setMemberStatus(memberId, status) {
      const companyId = adminWritable();
      if (status !== "active" && status !== "disabled") invalid("status must be active or disabled");
      const m = store.members.find((x) => x.id === memberId && x.companyId === companyId);
      if (!m) forbidden();
      if (m!.userId === userId) invalid("you cannot change your own status");
      m!.status = status;
      audit(companyId, "member.status_changed", "user", m!.userId, { status });
      return memberJson(m!);
    },
    async setMemberRole(memberId, role) {
      const companyId = adminWritable();
      if (role !== "admin" && role !== "employee") invalid("role must be admin or employee");
      const m = store.members.find((x) => x.id === memberId && x.companyId === companyId);
      if (!m) forbidden();
      if (m!.userId === userId) invalid("you cannot change your own role");
      m!.role = role;
      audit(companyId, "member.role_changed", "user", m!.userId, { role });
      return memberJson(m!);
    },
    async setMemberCode(memberId, code) {
      const companyId = adminWritable();
      const m = store.members.find((x) => x.id === memberId && x.companyId === companyId);
      if (!m) forbidden();
      const c = code.trim() || null;
      if (c && store.members.some((x) => x.id !== memberId && x.companyId === companyId && x.employeeCode?.toLowerCase() === c.toLowerCase())) {
        fail("conflict", "That employee code is already used in your company.");
      }
      m!.employeeCode = c;
      audit(companyId, "member.code_changed", "user", m!.userId);
      return memberJson(m!);
    },
    async listPermissions(uid): Promise<TablePermission[]> {
      requireUser();
      const companyId = myCompany();
      return store.perms
        .filter((p) => p.companyId === companyId && (p.userId === userId || isAdminOf(p.companyId)) && (!uid || p.userId === uid) && visibleTable(p.tableId))
        .sort((a, b) => store.tables.get(a.tableId)!.name.toLowerCase().localeCompare(store.tables.get(b.tableId)!.name.toLowerCase()))
        .map((p) => ({ userId: p.userId, tableId: p.tableId, tableName: store.tables.get(p.tableId)!.name, canView: p.view, canCreate: p.create, canEdit: p.edit, canDelete: p.delete, canImport: p.import, canExport: p.export }));
    },
    async setTablePermission(uid, tableId, f: PermissionFlags) {
      const companyId = adminWritable();
      const target = store.members.find((m) => m.userId === uid && m.companyId === companyId && m.role === "employee");
      const t = store.tables.get(tableId);
      if (!target || !t || t.companyId !== companyId) forbidden();
      const view = f.view || f.create || f.edit || f.delete || f.import || f.export;
      store.perms = store.perms.filter((p) => !(p.userId === uid && p.tableId === tableId));
      if (view) store.perms.push({ companyId, userId: uid, tableId, view: true, create: f.create, edit: f.edit, delete: f.delete, import: f.import, export: f.export });
      audit(companyId, "permission.changed", "user", uid, { ...f, table_id: tableId, view });
    },
    async listCompanyAudit(q: AuditQuery = {}): Promise<Page<AuditEvent>> {
      requireUser();
      const companyId = myCompany();
      const rows = store.audit
        .filter((a) => a.companyId === companyId && Boolean(companyId) && isAdminOf(companyId!) && (!q.action || a.action.startsWith(q.action)))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
      return { total: rows.length, rows: page(rows, q.offset ?? 0, clamp(q.limit, 50, 1, 200)).map((a) => auditJson(a, false)) };
    },

    // ---- billing ---------------------------------------------------------------------------------------------
    async listPayments() {
      requireUser();
      return store.payments
        .filter((p) => isFounder() || isAdminOf(p.companyId))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((p) => paymentJson(p));
    },
    async submitPayment(i: PaymentInput) {
      const companyId = myAdminCompany();
      if (!userId || !companyId || !canRead(companyId)) forbidden();
      if (store.payments.filter((p) => p.companyId === companyId && p.status === "pending").length >= 5) fail("limit", "too many pending payments; wait for review");
      const currency = i.currency.trim().toUpperCase();
      if (!(i.amount > 0 && i.amount < 100_000_000)) invalid("Enter an amount greater than zero.");
      if (!/^[A-Z]{3}$/.test(currency)) invalid("Use a 3-letter currency code, for example USD.");
      if (!Number.isInteger(i.months) || i.months < 1 || i.months > 36) invalid("Choose between 1 and 36 months.");
      if (i.method.trim().length < 1 || i.method.trim().length > 60) invalid("Enter how the payment was made.");
      const reference = i.reference.trim();
      if (reference.length < 3 || reference.length > 200) invalid("Enter the payment reference (3-200 characters).");
      if (i.note.length > 1000) invalid("The note is too long (1000 characters maximum).");
      if (store.payments.some((p) => p.companyId === companyId && p.reference.toLowerCase() === reference.toLowerCase())) fail("conflict", "That payment reference was already submitted.");
      const p: MPayment = {
        id: newId(store), companyId: companyId as string, submittedBy: userId as string, amount: Math.round(i.amount * 100) / 100, currency, months: i.months, method: i.method.trim(),
        reference, note: i.note.trim() || null, status: "pending", reviewedBy: null, reviewedAt: null, reviewNote: null, createdAt: now(),
      };
      store.payments.push(p);
      audit(companyId, "payment.submitted", "payment", p.id, { amount: p.amount, currency, months: p.months });
      return paymentJson(p);
    },
    async getPlatformSettings(): Promise<PlatformSettings> {
      requireUser();
      return Object.fromEntries(store.settings.entries());
    },

    // ---- founder -----------------------------------------------------------------------------------------------------
    async founderOverview(): Promise<FounderOverview> {
      requireFounder();
      const cs = [...store.companies.values()];
      const acc = (id: string) => companyAccess(id);
      const sub = (id: string) => store.subs.get(id);
      const nowD = now();
      const months: { month: string; count: number }[] = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() - i, 1));
        const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
        months.push({ month: key, count: cs.filter((c) => c.createdAt.getUTCFullYear() === d.getUTCFullYear() && c.createdAt.getUTCMonth() === d.getUTCMonth()).length });
      }
      const approved = store.payments.filter((p) => p.status === "approved" && p.reviewedAt && p.reviewedAt.getTime() >= nowD.getTime() - 30 * DAY);
      const byCur = new Map<string, number>();
      approved.forEach((p) => byCur.set(p.currency, (byCur.get(p.currency) ?? 0) + p.amount));
      return {
        companiesTotal: cs.length,
        suspended: cs.filter((c) => acc(c.id) === "suspended").length,
        trialing: cs.filter((c) => acc(c.id) === "full" && sub(c.id)?.status === "trialing").length,
        activePaid: cs.filter((c) => acc(c.id) === "full" && sub(c.id)?.status === "active").length,
        expired: cs.filter((c) => acc(c.id) === "read_only").length,
        trialsEnding7d: cs.filter((c) => acc(c.id) === "full" && sub(c.id)?.status === "trialing" && sub(c.id)!.trialEndsAt.getTime() <= nowD.getTime() + 7 * DAY).length,
        membersTotal: store.members.length,
        tablesTotal: store.tables.size,
        rowsTotal: [...store.rows.values()].reduce((n, r) => n + r.length, 0),
        paymentsPending: store.payments.filter((p) => p.status === "pending").length,
        paymentsApproved30d: [...byCur.entries()].sort().map(([currency, total]) => ({ currency, total })),
        signupsByMonth: months,
      };
    },
    async founderListCompanies(q: FounderCompanyQuery = {}): Promise<Page<FounderCompanyRow>> {
      requireFounder();
      const state = q.state ?? "all";
      if (!["all", "trialing", "active", "expired", "suspended"].includes(state)) invalid("unknown state filter");
      const needle = q.search?.trim().toLowerCase();
      const rows: FounderCompanyRow[] = [...store.companies.values()].map((c) => {
        const s = store.subs.get(c.id);
        const admin = store.members.filter((m) => m.companyId === c.id && m.role === "admin").sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
        return {
          id: c.id, name: c.name, status: c.status, createdAt: c.createdAt.toISOString(), plan: s?.plan ?? null, subscriptionStatus: s?.status ?? null,
          trialEndsAt: iso(s?.trialEndsAt ?? null), currentPeriodEnd: iso(s?.currentPeriodEnd ?? null), access: companyAccess(c.id),
          members: store.members.filter((m) => m.companyId === c.id).length, tables: [...store.tables.values()].filter((t) => t.companyId === c.id).length,
          adminEmail: admin ? store.users.get(admin.userId)?.email ?? null : null,
        };
      });
      const filtered = rows
        .filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.adminEmail ?? "").toLowerCase().includes(needle))
        .filter((r) => state === "all" || (state === "suspended" ? r.access === "suspended" : state === "expired" ? r.access === "read_only" : r.access === "full" && r.subscriptionStatus === state))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
      return { total: filtered.length, rows: page(filtered, q.offset ?? 0, clamp(q.limit, 25, 1, 100)) };
    },
    async founderCompanyDetail(companyId): Promise<FounderCompanyDetail> {
      requireFounder();
      const c = store.companies.get(companyId);
      if (!c) notFound();
      const s = store.subs.get(companyId);
      return {
        id: c!.id, name: c!.name, status: c!.status, createdAt: c!.createdAt.toISOString(), contactEmail: c!.contactEmail, phone: c!.phone, address: c!.address,
        access: companyAccess(companyId),
        subscription: { plan: s?.plan ?? null, status: s?.status ?? null, trialStartedAt: iso(s?.trialStartedAt ?? null), trialEndsAt: iso(s?.trialEndsAt ?? null), currentPeriodEnd: iso(s?.currentPeriodEnd ?? null) },
        members: store.members.filter((m) => m.companyId === companyId).length,
        tables: [...store.tables.values()].filter((t) => t.companyId === companyId).length,
        rows: [...store.tables.values()].filter((t) => t.companyId === companyId).reduce((n, t) => n + rowsOf(t.id).length, 0),
        payments: store.payments.filter((p) => p.companyId === companyId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map((p) => paymentJson(p)),
      };
    },
    async founderListMembers(companyId) {
      requireFounder();
      return store.members.filter((m) => m.companyId === companyId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(memberJson);
    },
    async founderListPayments(status?: PaymentStatus, limit?: number, offset?: number): Promise<Page<Payment>> {
      requireFounder();
      if (status && !["pending", "approved", "rejected"].includes(status)) invalid("unknown status filter");
      const rows = store.payments
        .filter((p) => !status || p.status === status)
        .sort((a, b) => Number(b.status === "pending") - Number(a.status === "pending") || b.createdAt.getTime() - a.createdAt.getTime());
      return { total: rows.length, rows: page(rows, offset ?? 0, clamp(limit, 25, 1, 100)).map((p) => paymentJson(p, true)) };
    },
    async founderReviewPayment(paymentId, decision, note) {
      requireFounder();
      if (decision !== "approve" && decision !== "reject") invalid("decision must be approve or reject");
      const p = store.payments.find((x) => x.id === paymentId);
      if (!p) notFound();
      if (p!.status !== "pending") invalid("payment was already reviewed");
      if (decision === "reject" && !note?.trim()) invalid("a reason is required to reject a payment");
      let periodEnd: Date | null = null;
      if (decision === "approve") {
        const s = store.subs.get(p!.companyId);
        if (!s) notFound();
        const base = Math.max(now().getTime(), s!.currentPeriodEnd?.getTime() ?? -Infinity, s!.status === "trialing" ? s!.trialEndsAt.getTime() : -Infinity);
        periodEnd = addMonths(new Date(base), p!.months);
        Object.assign(s!, { status: "active", plan: "standard", currentPeriodEnd: periodEnd });
      }
      Object.assign(p!, { status: decision === "approve" ? "approved" : "rejected", reviewedBy: userId, reviewedAt: now(), reviewNote: note?.trim() || null });
      audit(p!.companyId, `payment.${p!.status}`, "payment", p!.id, { amount: p!.amount, currency: p!.currency, months: p!.months, period_end: iso(periodEnd) });
      return paymentJson(p!, true);
    },
    async founderAudit(q: AuditQuery = {}): Promise<Page<AuditEvent>> {
      requireFounder();
      const rows = store.audit
        .filter((a) => (!q.companyId || a.companyId === q.companyId) && (!q.action || a.action.startsWith(q.action)))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
      return { total: rows.length, rows: page(rows, q.offset ?? 0, clamp(q.limit, 50, 1, 200)).map((a) => auditJson(a, true)) };
    },
    async founderSetCompanyStatus(companyId, status, reason) {
      requireFounder();
      if (status !== "active" && status !== "suspended") invalid("invalid status");
      const c = store.companies.get(companyId);
      if (!c) notFound();
      c!.status = status;
      audit(companyId, "company.status_changed", "company", companyId, { status, reason: (reason ?? "").slice(0, 500) });
    },
    async founderSetSubscription(companyId, change) {
      requireFounder();
      if ((change.status as string) === "active") invalid("a subscription can only become active through an approved payment");
      const s = store.subs.get(companyId);
      if (!s) notFound();
      s!.status = change.status;
      s!.plan = change.status === "trialing" ? "trial" : "standard";
      if (change.trialEndsAt) s!.trialEndsAt = new Date(change.trialEndsAt);
      s!.currentPeriodEnd = null;
      audit(companyId, "subscription.updated", "company", companyId, { status: change.status, trial_ends_at: change.trialEndsAt ?? null });
    },
    async founderCreateCompany(adminUserId, name) {
      requireFounder();
      const n = nameOk(name, 2, "company name");
      const u = store.users.get(adminUserId);
      if (!u) notFound();
      if (u!.isFounder || store.members.some((m) => m.userId === adminUserId)) fail("conflict", "That already exists.");
      const id = newId(store);
      store.companies.set(id, { id, name: n, status: "active", contactEmail: null, phone: null, address: null, createdAt: now() });
      store.members.push({ id: newId(store), companyId: id, userId: adminUserId, role: "admin", status: "active", employeeCode: null, createdAt: now() });
      store.subs.set(id, { companyId: id, plan: "trial", status: "trialing", trialStartedAt: now(), trialEndsAt: new Date(now().getTime() + 30 * DAY), currentPeriodEnd: null });
      audit(id, "company.provisioned", "company", id, { name: n, admin_user: adminUserId });
      return id;
    },
    async founderUpdateSetting(key: SettingKey, value) {
      requireFounder();
      if (!["payment_instructions", "support_email", "plan_price_text"].includes(key)) invalid("unknown setting");
      const v = value.trim();
      if (v.length > 4000) invalid("That value is too long.");
      if (v === "") store.settings.delete(key);
      else store.settings.set(key, v);
      audit(null, "settings.updated", "setting", null, { key });
    },
  };
  return port;
}
