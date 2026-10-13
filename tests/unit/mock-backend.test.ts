import { describe, expect, it, beforeEach } from "vitest";

import { createMockBackend } from "@/lib/backend/mock";
import { createSeededStore, MOCK_PASSWORD, SEED_IDS, type MockStore } from "@/lib/backend/mock/store";
import { BackendError } from "@/lib/backend/port";

// Conformance of the DEV/TEST mock to the rules proven on real PostgreSQL in
// tests/db. These tests prove the mock matches those rules; they say nothing
// about hosted Supabase.

let store: MockStore;
const as = (userId: string | null) => {
  let current = userId;
  return createMockBackend({ get: () => current, set: (id) => (current = id) }, store);
};
const kind = async (p: Promise<unknown>) => {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof BackendError ? e.kind : "other";
  }
};

beforeEach(() => {
  store = createSeededStore(new Date("2026-10-13T12:00:00Z"));
});

describe("context & access states", () => {
  it("derives access per persona", async () => {
    expect((await as(SEED_IDS.alice).data.getContext())?.access).toBe("full");
    expect((await as(SEED_IDS.bob).data.getContext())?.access).toBe("read_only");
    expect((await as(SEED_IDS.carol).data.getContext())?.access).toBe("suspended");
    expect((await as(SEED_IDS.newcomer).data.getContext())?.access).toBe("none");
    expect(await as(null).data.getContext()).toBeNull();
  });
});

describe("tenant isolation & permissions", () => {
  it("hides other tenants' tables and rows", async () => {
    const bob = as(SEED_IDS.bob);
    expect((await bob.data.listTables()).map((t) => t.name)).toEqual(["Veneer stock"]);
    expect(await bob.data.getTable(SEED_IDS.ordersA)).toBeNull();
    expect((await bob.data.queryRows(SEED_IDS.ordersA)).total).toBe(0);
  });
  it("employees see only granted tables and cannot manage", async () => {
    expect((await as(SEED_IDS.edie).data.listTables()).map((t) => t.name)).toEqual(["Orders", "Vendors"]);
    expect(await as(SEED_IDS.nora).data.listTables()).toEqual([]);
    expect(await kind(as(SEED_IDS.edie).data.createTable("X", [{ key: "a", label: "A", type: "text" }]))).toBe("forbidden");
    expect(await kind(as(SEED_IDS.edie).data.dropTable(SEED_IDS.ordersA))).toBe("forbidden");
  });
  it("row permissions are enforced per operation", async () => {
    const row = { sku: "NEW-1" };
    expect(await kind(as(SEED_IDS.edie).data.insertRow(SEED_IDS.ordersA, row))).toBe("ok");
    expect(await kind(as(SEED_IDS.vic).data.insertRow(SEED_IDS.ordersA, row))).toBe("forbidden");
    const page = await as(SEED_IDS.edie).data.queryRows(SEED_IDS.ordersA, { limit: 1 });
    expect(await as(SEED_IDS.edie).data.deleteRows(SEED_IDS.ordersA, [page.rows[0].id])).toBe(0);
    expect(await kind(as(SEED_IDS.vic).data.authorizeExport(SEED_IDS.ordersA))).toBe("ok");
    expect(await kind(as(SEED_IDS.edie).data.authorizeExport(SEED_IDS.ordersA))).toBe("forbidden");
    expect(await kind(as(SEED_IDS.nora).data.authorizeExport(SEED_IDS.ordersA))).toBe("forbidden");
  });
  it("a company admin cannot grant permissions across companies", async () => {
    const flags = { view: true, create: false, edit: false, delete: false, import: false, export: false };
    expect(await kind(as(SEED_IDS.alice).data.setTablePermission(SEED_IDS.bob, SEED_IDS.ordersA, flags))).toBe("forbidden");
    expect(await kind(as(SEED_IDS.alice).data.setTablePermission(SEED_IDS.nora, SEED_IDS.veneerB, flags))).toBe("forbidden");
  });
  it("any operation implies view", async () => {
    const alice = as(SEED_IDS.alice);
    await alice.data.setTablePermission(SEED_IDS.nora, SEED_IDS.vendorsA, { view: false, create: false, edit: false, delete: false, import: false, export: true });
    const perms = await alice.data.listPermissions(SEED_IDS.nora);
    expect(perms).toHaveLength(1);
    expect(perms[0].canView).toBe(true);
  });
});

describe("trial expiry & suspension", () => {
  it("expired trial: reads allowed, writes rejected", async () => {
    const bob = as(SEED_IDS.bob);
    expect((await bob.data.queryRows(SEED_IDS.veneerB)).total).toBe(40);
    expect(await kind(bob.data.authorizeExport(SEED_IDS.veneerB))).toBe("ok");
    expect(await kind(bob.data.insertRow(SEED_IDS.veneerB, { grade: "X" }))).toBe("forbidden");
    expect(await kind(bob.data.createTable("T", [{ key: "a", label: "A", type: "text" }]))).toBe("forbidden");
  });
  it("suspended company has no data access at all", async () => {
    const carol = as(SEED_IDS.carol);
    expect(await carol.data.listTables()).toEqual([]);
    expect(await kind(carol.data.submitPayment({ amount: 1, currency: "USD", months: 1, method: "x", reference: "abc", note: "" }))).toBe("forbidden");
  });
  it("only an approved payment makes a subscription active, extending from the later date", async () => {
    const founder = as(SEED_IDS.founder);
    expect(await kind(founder.data.founderSetSubscription(SEED_IDS.birch, { status: "active" as never }))).toBe("invalid");
    const pending = store.payments.find((p) => p.status === "pending")!;
    const before = Date.now();
    await founder.data.founderReviewPayment(pending.id, "approve");
    expect((await as(SEED_IDS.bob).data.getContext())?.access).toBe("full");
    const end = store.subs.get(SEED_IDS.birch)!.currentPeriodEnd!.getTime();
    expect(end).toBeGreaterThan(before);
    expect(await kind(founder.data.founderReviewPayment(pending.id, "approve"))).toBe("invalid");
  });
  it("rejection needs a reason and does not change the subscription", async () => {
    const founder = as(SEED_IDS.founder);
    const pending = store.payments.find((p) => p.status === "pending")!;
    expect(await kind(founder.data.founderReviewPayment(pending.id, "reject"))).toBe("invalid");
    await founder.data.founderReviewPayment(pending.id, "reject", "Wrong amount");
    expect((await as(SEED_IDS.bob).data.getContext())?.access).toBe("read_only");
  });
});

describe("founder boundary", () => {
  it("non-founders cannot use founder operations", async () => {
    for (const id of [SEED_IDS.alice, SEED_IDS.edie, SEED_IDS.newcomer]) {
      const b = as(id);
      expect(await kind(b.data.founderOverview())).toBe("forbidden");
      expect(await kind(b.data.founderListCompanies())).toBe("forbidden");
      expect(await kind(b.data.founderSetCompanyStatus(SEED_IDS.acme, "suspended"))).toBe("forbidden");
      expect(await kind(b.data.founderUpdateSetting("support_email", "x@y.test"))).toBe("forbidden");
    }
    expect(await kind(as(null).data.founderOverview())).toBe("forbidden");
  });
  it("founder suspension revokes access immediately and is audited", async () => {
    await as(SEED_IDS.founder).data.founderSetCompanyStatus(SEED_IDS.acme, "suspended", "test");
    expect((await as(SEED_IDS.alice).data.getContext())?.access).toBe("suspended");
    expect(await as(SEED_IDS.alice).data.listTables()).toEqual([]);
    const audit = await as(SEED_IDS.founder).data.founderAudit({ action: "company.status_changed" });
    expect(audit.rows[0].metadata).toMatchObject({ status: "suspended" });
  });
  it("founder company list paginates and filters", async () => {
    const f = as(SEED_IDS.founder).data;
    const all = await f.founderListCompanies({ limit: 10, offset: 0 });
    expect(all.total).toBe(30);
    expect(all.rows).toHaveLength(10);
    expect((await f.founderListCompanies({ state: "suspended" })).rows.map((r) => r.name)).toEqual(["Cedar Boards"]);
    expect((await f.founderListCompanies({ search: "birch" })).total).toBe(1);
  });
});

describe("rows: validation, query, import", () => {
  it("rejects invalid values with a readable message", async () => {
    const alice = as(SEED_IDS.alice).data;
    expect(await kind(alice.insertRow(SEED_IDS.ordersA, { qty: "abc" }))).toBe("invalid");
    expect(await kind(alice.insertRow(SEED_IDS.ordersA, { qty: 3 }))).toBe("invalid"); // sku required
    expect(await kind(alice.insertRow(SEED_IDS.ordersA, { sku: "A", received: "2026-02-30" }))).toBe("invalid");
  });
  it("paginates, sorts (nulls last) and filters", async () => {
    const alice = as(SEED_IDS.alice).data;
    const p1 = await alice.queryRows(SEED_IDS.ordersA, { limit: 20, sortKey: "qty", sortDir: "desc" });
    expect(p1.total).toBe(250);
    expect(p1.rows).toHaveLength(20);
    const qtys = p1.rows.map((r) => r.data.qty as number);
    expect([...qtys].sort((a, b) => b - a)).toEqual(qtys);
    expect((await alice.queryRows(SEED_IDS.ordersA, { limit: 9999 })).limit).toBe(500);
    const f = await alice.queryRows(SEED_IDS.ordersA, { filters: [{ key: "sku", op: "eq", value: "PLY-1001" }] });
    expect(f.total).toBe(1);
    expect((await alice.queryRows(SEED_IDS.ordersA, { search: "ply-1002" })).total).toBe(1);
  });
  it("import is atomic: one bad row changes nothing and records a failed job", async () => {
    const alice = as(SEED_IDS.alice).data;
    const out = await alice.importRows(SEED_IDS.vendorsA, "replace", [{ name: "A" }, { contact: "no name" }], "x.csv");
    expect(out.ok).toBe(false);
    expect((await alice.queryRows(SEED_IDS.vendorsA)).total).toBe(8);
    expect((await alice.listImportJobs(SEED_IDS.vendorsA))[0].status).toBe("failed");
  });
  it("replace swaps all rows; append adds; employees cannot replace", async () => {
    const alice = as(SEED_IDS.alice).data;
    const ok = await alice.importRows(SEED_IDS.vendorsA, "replace", [{ name: "Only" }], "y.csv");
    expect(ok).toMatchObject({ ok: true, inserted: 1, deleted: 8 });
    await alice.importRows(SEED_IDS.vendorsA, "append", [{ name: "Two" }], null);
    expect((await alice.queryRows(SEED_IDS.vendorsA)).total).toBe(2);
    expect(await kind(as(SEED_IDS.edie).data.importRows(SEED_IDS.vendorsA, "replace", [{ name: "z" }], null))).toBe("forbidden");
    expect(await kind(as(SEED_IDS.edie).data.importRows(SEED_IDS.vendorsA, "append", [{ name: "z" }], null))).toBe("forbidden"); // no import grant
  });
});

describe("schema changes", () => {
  it("keeps stable keys, drops removed column data, blocks incompatible retype", async () => {
    const alice = as(SEED_IDS.alice).data;
    const t = (await alice.getTable(SEED_IDS.vendorsA))!;
    const cols = t.columns.map((c) => (c.key === "name" ? { ...c, label: "Vendor name" } : c)).filter((c) => c.key !== "contact");
    const updated = await alice.updateTableSchema(SEED_IDS.vendorsA, cols);
    expect(updated.columns.find((c) => c.key === "name")?.label).toBe("Vendor name");
    expect((await alice.queryRows(SEED_IDS.vendorsA)).rows[0].data).not.toHaveProperty("contact");
    const bad = cols.map((c) => (c.key === "name" ? { ...c, type: "integer" as const } : c));
    expect(await kind(alice.updateTableSchema(SEED_IDS.vendorsA, bad))).toBe("invalid");
  });
  it("rename enforces unique names; clear and drop remove data", async () => {
    const alice = as(SEED_IDS.alice).data;
    expect(await kind(alice.renameTable(SEED_IDS.vendorsA, "orders"))).toBe("conflict");
    expect(await alice.clearTable(SEED_IDS.vendorsA)).toBe(8);
    await alice.dropTable(SEED_IDS.vendorsA);
    expect(await alice.getTable(SEED_IDS.vendorsA)).toBeNull();
  });
});

describe("members", () => {
  it("generates the next employee code and refuses founders/duplicates", async () => {
    const admin = as(SEED_IDS.alice);
    const invited = await admin.authAdmin.inviteUser({ email: "new@acme.test", fullName: "New", redirectTo: "x" });
    if (!invited.ok) throw new Error("invite failed");
    const m = await admin.data.addMember(invited.userId);
    expect(m.employeeCode).toBe("EMP-0004");
    expect(await kind(admin.data.addMember(invited.userId))).toBe("conflict");
    expect(await kind(admin.data.addMember(SEED_IDS.founder))).toBe("conflict");
  });
  it("admins cannot demote or disable themselves; employees cannot list others", async () => {
    const members = await as(SEED_IDS.alice).data.listMembers();
    const self = members.find((m) => m.userId === SEED_IDS.alice)!;
    expect(await kind(as(SEED_IDS.alice).data.setMemberStatus(self.id, "disabled"))).toBe("invalid");
    expect(await kind(as(SEED_IDS.alice).data.setMemberRole(self.id, "employee"))).toBe("invalid");
    expect((await as(SEED_IDS.edie).data.listMembers()).map((m) => m.userId)).toEqual([SEED_IDS.edie]);
  });
  it("a disabled member loses access", async () => {
    const m = (await as(SEED_IDS.alice).data.listMembers()).find((x) => x.userId === SEED_IDS.edie)!;
    await as(SEED_IDS.alice).data.setMemberStatus(m.id, "disabled");
    expect((await as(SEED_IDS.edie).data.getContext())?.access).toBe("disabled");
    expect(await as(SEED_IDS.edie).data.listTables()).toEqual([]);
  });
});

describe("payments", () => {
  const pay = (reference: string) => ({ amount: 10, currency: "usd", months: 1, method: "Bank", reference, note: "" });
  it("validates, normalises and rejects duplicate references", async () => {
    const alice = as(SEED_IDS.alice).data;
    const p = await alice.submitPayment(pay("REF-123"));
    expect(p.currency).toBe("USD");
    expect(await kind(alice.submitPayment(pay(" ref-123 ")))).toBe("conflict");
    expect(await kind(alice.submitPayment({ ...pay("OK-1"), amount: 0 }))).toBe("invalid");
    expect(await kind(as(SEED_IDS.edie).data.submitPayment(pay("EMP-1")))).toBe("forbidden");
  });
  it("expired companies can submit payments", async () => {
    expect(await kind(as(SEED_IDS.bob).data.submitPayment(pay("BOB-REF-9")))).toBe("ok");
  });
});

describe("auth", () => {
  it("signs in, rejects bad credentials and unconfirmed accounts", async () => {
    const b = as(null);
    expect(await b.auth.signInWithPassword("alice@acme.test", "nope")).toEqual({ ok: false, code: "invalid_credentials" });
    expect(await b.auth.signInWithPassword("alice@acme.test", MOCK_PASSWORD)).toEqual({ ok: true });
    expect((await b.auth.getUser())?.email).toBe("alice@acme.test");
    expect((await b.data.getContext())?.access).toBe("full");
    await b.auth.signOut();
    expect(await b.auth.getUser()).toBeNull();
  });
  it("+confirm sign-up stays pending until the mock link is opened", async () => {
    const b = as(null);
    const r = await b.auth.signUp({ email: "x+confirm@shop.test", password: "longenough1", fullName: "X", companyName: "X Co", redirectTo: "r" });
    expect(r).toEqual({ ok: true, sessionStarted: false });
    expect((await b.auth.signInWithPassword("x+confirm@shop.test", "longenough1")).ok).toBe(false);
    const id = [...store.users.values()].find((u) => u.email === "x+confirm@shop.test")!.id;
    expect(await b.auth.exchangeCode(`mock:${id}`)).toBe(true);
    expect((await b.data.registerCompany("X Co")).length).toBeGreaterThan(0);
  });
  it("sign-up for an existing email reveals nothing; weak passwords are refused", async () => {
    const b = as(null);
    expect(await b.auth.signUp({ email: "alice@acme.test", password: "longenough1", fullName: "A", companyName: "A Co", redirectTo: "r" })).toEqual({ ok: true, sessionStarted: false });
    expect(await b.auth.signUp({ email: "z@z.test", password: "short", fullName: "Z", companyName: "Z Co", redirectTo: "r" })).toEqual({ ok: false, code: "weak_password" });
  });
  it("password change needs a session and a different strong password", async () => {
    expect(await as(null).auth.updatePassword("longenough1")).toEqual({ ok: false, code: "session_required" });
    const b = as(SEED_IDS.alice);
    expect(await b.auth.updatePassword(MOCK_PASSWORD)).toEqual({ ok: false, code: "same_password" });
    expect(await b.auth.updatePassword("short")).toEqual({ ok: false, code: "weak_password" });
    expect(await b.auth.updatePassword("brand-new-pass-1")).toEqual({ ok: true });
    expect(await b.auth.verifyPassword("alice@acme.test", "brand-new-pass-1")).toEqual({ ok: true });
  });
  it("a new user can register one company but not two, and founders cannot", async () => {
    const n = as(SEED_IDS.newcomer);
    await n.data.registerCompany("Newcomer Wood");
    expect(await kind(n.data.registerCompany("Second"))).toBe("conflict");
    expect(await kind(as(SEED_IDS.founder).data.registerCompany("Nope"))).toBe("forbidden");
  });
});
