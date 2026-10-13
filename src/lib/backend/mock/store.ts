// DEVELOPMENT / TEST ONLY. An in-memory stand-in for the database so the whole
// application can be exercised, previewed and browser-tested without a hosted
// Supabase project. It is selected ONLY by an explicit APP_BACKEND=mock (see
// src/lib/backend/index.ts), is refused in production, and holds nothing real:
// every record below is fictional and every "password" is the same dummy string.
//
// Passing tests against this store prove the application logic and UI behave
// correctly GIVEN backend rules identical to the SQL functions. They are NOT
// evidence that hosted Supabase works; the SQL itself is tested separately on a
// real PostgreSQL (npm run test:db).

import type { ColumnDef, RowData } from "@/lib/data/types";

export const MOCK_PASSWORD = "mock-password-123";
export const MOCK_COOKIE = "tdm_mock_user";

export interface MUser {
  id: string;
  email: string;
  fullName: string;
  emailConfirmed: boolean;
  isFounder: boolean;
  pendingCompanyName: string | null;
  createdAt: Date;
}
export interface MCompany {
  id: string;
  name: string;
  status: "active" | "suspended";
  contactEmail: string | null;
  phone: string | null;
  address: string | null;
  createdAt: Date;
}
export interface MMember {
  id: string;
  companyId: string;
  userId: string;
  role: "admin" | "employee";
  status: "active" | "disabled";
  employeeCode: string | null;
  createdAt: Date;
}
export interface MSub {
  companyId: string;
  plan: string;
  status: "trialing" | "active" | "past_due" | "canceled";
  trialStartedAt: Date;
  trialEndsAt: Date;
  currentPeriodEnd: Date | null;
}
export interface MTable {
  id: string;
  companyId: string;
  name: string;
  columns: ColumnDef[];
  createdAt: Date;
  updatedAt: Date;
  dataUpdatedAt: Date;
}
export interface MRow {
  id: string;
  tableId: string;
  companyId: string;
  rowOrder: number;
  data: RowData;
  createdAt: Date;
  updatedAt: Date;
}
export interface MPerm {
  companyId: string;
  userId: string;
  tableId: string;
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  import: boolean;
  export: boolean;
}
export interface MImportJob {
  id: string;
  companyId: string;
  tableId: string | null;
  tableName: string;
  mode: "append" | "replace";
  fileName: string | null;
  status: "succeeded" | "failed";
  rowsReceived: number;
  rowsInserted: number;
  rowsDeleted: number;
  errors: { row: number; message: string }[];
  errorCount: number;
  createdBy: string;
  createdAt: Date;
}
export interface MPayment {
  id: string;
  companyId: string;
  submittedBy: string;
  amount: number;
  currency: string;
  months: number;
  method: string;
  reference: string;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  reviewedBy: string | null;
  reviewedAt: Date | null;
  reviewNote: string | null;
  createdAt: Date;
}
export interface MAudit {
  id: number;
  companyId: string | null;
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export interface MockStore {
  users: Map<string, MUser>;
  companies: Map<string, MCompany>;
  members: MMember[];
  subs: Map<string, MSub>;
  tables: Map<string, MTable>;
  rows: Map<string, MRow[]>;
  perms: MPerm[];
  jobs: MImportJob[];
  payments: MPayment[];
  audit: MAudit[];
  settings: Map<string, string>;
  seq: { row: number; audit: number; id: number };
}

const DAY = 86_400_000;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newId(store: MockStore): string {
  store.seq.id += 1;
  return `00000000-0000-4000-8000-${store.seq.id.toString(16).padStart(12, "0")}`;
}

export const SEED_IDS = {
  founder: "00000000-0000-4000-8000-0000000000f1",
  alice: "00000000-0000-4000-8000-0000000000a1",
  edie: "00000000-0000-4000-8000-0000000000a2",
  vic: "00000000-0000-4000-8000-0000000000a3",
  nora: "00000000-0000-4000-8000-0000000000a4",
  bob: "00000000-0000-4000-8000-0000000000b1",
  carol: "00000000-0000-4000-8000-0000000000c1",
  dan: "00000000-0000-4000-8000-0000000000d1",
  newcomer: "00000000-0000-4000-8000-0000000000e1",
  acme: "00000000-0000-4000-8000-00000000aaa1",
  birch: "00000000-0000-4000-8000-00000000bbb1",
  cedar: "00000000-0000-4000-8000-00000000ccc1",
  delta: "00000000-0000-4000-8000-00000000ddd1",
  ordersA: "00000000-0000-4000-8000-0000000a0001",
  vendorsA: "00000000-0000-4000-8000-0000000a0002",
  veneerB: "00000000-0000-4000-8000-0000000b0001",
  panelsD: "00000000-0000-4000-8000-0000000d0001",
} as const;

export interface PersonaInfo {
  id: string;
  label: string;
  description: string;
}

export const PERSONAS: PersonaInfo[] = [
  { id: SEED_IDS.founder, label: "Founder", description: "Platform super admin" },
  { id: SEED_IDS.alice, label: "Alice (Acme admin)", description: "Company admin, free trial" },
  { id: SEED_IDS.edie, label: "Edie (Acme editor)", description: "Employee: edit Orders, view Vendors" },
  { id: SEED_IDS.vic, label: "Vic (Acme viewer)", description: "Employee: view + export Orders" },
  { id: SEED_IDS.nora, label: "Nora (Acme, no access)", description: "Employee with no table grants" },
  { id: SEED_IDS.bob, label: "Bob (Birch admin)", description: "Trial expired: read-only" },
  { id: SEED_IDS.carol, label: "Carol (Cedar admin)", description: "Company suspended" },
  { id: SEED_IDS.dan, label: "Dan (Delta admin)", description: "Paid subscription" },
  { id: SEED_IDS.newcomer, label: "Newcomer", description: "Signed in, no company yet" },
];

export function createSeededStore(now: Date = new Date()): MockStore {
  const store: MockStore = {
    users: new Map(),
    companies: new Map(),
    members: [],
    subs: new Map(),
    tables: new Map(),
    rows: new Map(),
    perms: [],
    jobs: [],
    payments: [],
    audit: [],
    settings: new Map(),
    seq: { row: 0, audit: 0, id: 0x1000 },
  };
  const at = (days: number) => new Date(now.getTime() + days * DAY);

  const user = (id: string, email: string, fullName: string, extra: Partial<MUser> = {}) =>
    store.users.set(id, { id, email, fullName, emailConfirmed: true, isFounder: false, pendingCompanyName: null, createdAt: at(-60), ...extra });
  const company = (id: string, name: string, status: "active" | "suspended", daysAgo: number) =>
    store.companies.set(id, { id, name, status, contactEmail: null, phone: null, address: null, createdAt: at(-daysAgo) });
  const member = (companyId: string, userId: string, role: "admin" | "employee", code: string | null, daysAgo = 30) =>
    store.members.push({ id: newId(store), companyId, userId, role, status: "active", employeeCode: code, createdAt: at(-daysAgo) });
  const sub = (companyId: string, s: Omit<MSub, "companyId">) => store.subs.set(companyId, { companyId, ...s });
  const log = (companyId: string | null, actorId: string | null, action: string, daysAgo: number, metadata: Record<string, unknown> = {}) =>
    store.audit.push({ id: ++store.seq.audit, companyId, actorId, action, targetType: null, targetId: null, metadata, createdAt: at(-daysAgo) });

  user(SEED_IDS.founder, "founder@mock.test", "Fiona Founder", { isFounder: true });
  user(SEED_IDS.alice, "alice@acme.test", "Alice Admin");
  user(SEED_IDS.edie, "edie@acme.test", "Edie Editor");
  user(SEED_IDS.vic, "vic@acme.test", "Vic Viewer");
  user(SEED_IDS.nora, "nora@acme.test", "Nora NoAccess");
  user(SEED_IDS.bob, "bob@birch.test", "Bob Birch");
  user(SEED_IDS.carol, "carol@cedar.test", "Carol Cedar");
  user(SEED_IDS.dan, "dan@delta.test", "Dan Delta");
  user(SEED_IDS.newcomer, "newcomer@mock.test", "Nia Newcomer");

  company(SEED_IDS.acme, "Acme Plywood Co", "active", 9);
  company(SEED_IDS.birch, "Birch Veneer Ltd", "active", 41);
  company(SEED_IDS.cedar, "Cedar Boards", "suspended", 70);
  company(SEED_IDS.delta, "Delta Panels", "active", 120);

  member(SEED_IDS.acme, SEED_IDS.alice, "admin", null, 9);
  member(SEED_IDS.acme, SEED_IDS.edie, "employee", "EMP-0001", 8);
  member(SEED_IDS.acme, SEED_IDS.vic, "employee", "EMP-0002", 7);
  member(SEED_IDS.acme, SEED_IDS.nora, "employee", "EMP-0003", 6);
  member(SEED_IDS.birch, SEED_IDS.bob, "admin", null, 41);
  member(SEED_IDS.cedar, SEED_IDS.carol, "admin", null, 70);
  member(SEED_IDS.delta, SEED_IDS.dan, "admin", null, 120);

  sub(SEED_IDS.acme, { plan: "trial", status: "trialing", trialStartedAt: at(-9), trialEndsAt: at(21), currentPeriodEnd: null });
  sub(SEED_IDS.birch, { plan: "trial", status: "trialing", trialStartedAt: at(-41), trialEndsAt: at(-11), currentPeriodEnd: null });
  sub(SEED_IDS.cedar, { plan: "standard", status: "active", trialStartedAt: at(-70), trialEndsAt: at(-40), currentPeriodEnd: at(12) });
  sub(SEED_IDS.delta, { plan: "standard", status: "active", trialStartedAt: at(-120), trialEndsAt: at(-90), currentPeriodEnd: at(45) });

  const rnd = mulberry32(20260101);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const table = (id: string, companyId: string, name: string, columns: ColumnDef[]) => {
    store.tables.set(id, { id, companyId, name, columns, createdAt: at(-8), updatedAt: at(-8), dataUpdatedAt: at(-1) });
    store.rows.set(id, []);
  };
  const addRow = (tableId: string, companyId: string, data: RowData) => {
    const t = new Date(now.getTime() - rnd() * 7 * DAY);
    store.rows.get(tableId)!.push({ id: newId(store), tableId, companyId, rowOrder: ++store.seq.row, data, createdAt: t, updatedAt: t });
  };

  table(SEED_IDS.ordersA, SEED_IDS.acme, "Orders", [
    { key: "sku", label: "SKU", type: "text", required: true },
    { key: "product", label: "Product", type: "text" },
    { key: "qty", label: "Quantity", type: "integer" },
    { key: "price", label: "Unit price", type: "number" },
    { key: "in_stock", label: "In stock", type: "boolean" },
    { key: "received", label: "Received", type: "date" },
  ]);
  const products = ["Birch plywood 18mm", "Marine plywood 12mm", "MDF board 9mm", "Oak veneer sheet", "Pine plywood 6mm", "Laminated panel"];
  for (let i = 1; i <= 250; i++) {
    addRow(SEED_IDS.ordersA, SEED_IDS.acme, {
      sku: `PLY-${String(1000 + i)}`,
      product: pick(products),
      qty: Math.floor(rnd() * 400) + 1,
      price: Math.round((rnd() * 80 + 8) * 100) / 100,
      in_stock: rnd() > 0.3,
      received: `2026-0${1 + Math.floor(rnd() * 9)}-${String(1 + Math.floor(rnd() * 28)).padStart(2, "0")}`,
    });
  }
  table(SEED_IDS.vendorsA, SEED_IDS.acme, "Vendors", [
    { key: "name", label: "Vendor", type: "text", required: true },
    { key: "contact", label: "Contact", type: "text" },
    { key: "active", label: "Active", type: "boolean" },
  ]);
  ["Timber Supply Co", "Northern Glue Works", "Hardware Hub", "Coastal Logistics", "Veneer Traders", "Saw & Blade Ltd", "Pack-It Pallets", "Finish Chem"].forEach((n, i) =>
    addRow(SEED_IDS.vendorsA, SEED_IDS.acme, { name: n, contact: `contact${i + 1}@vendor.test`, active: i % 5 !== 4 }),
  );
  table(SEED_IDS.veneerB, SEED_IDS.birch, "Veneer stock", [
    { key: "grade", label: "Grade", type: "text", required: true },
    { key: "sheets", label: "Sheets", type: "integer" },
  ]);
  for (let i = 1; i <= 40; i++) addRow(SEED_IDS.veneerB, SEED_IDS.birch, { grade: `G${(i % 5) + 1}`, sheets: Math.floor(rnd() * 900) });
  table(SEED_IDS.panelsD, SEED_IDS.delta, "Panels", [
    { key: "code", label: "Code", type: "text", required: true },
    { key: "width", label: "Width (mm)", type: "integer" },
  ]);
  for (let i = 1; i <= 30; i++) addRow(SEED_IDS.panelsD, SEED_IDS.delta, { code: `D-${i}`, width: 600 + i * 10 });

  const grant = (userId: string, tableId: string, f: Partial<Omit<MPerm, "companyId" | "userId" | "tableId">>) =>
    store.perms.push({ companyId: store.tables.get(tableId)!.companyId, userId, tableId, view: true, create: false, edit: false, delete: false, import: false, export: false, ...f });
  grant(SEED_IDS.edie, SEED_IDS.ordersA, { create: true, edit: true });
  grant(SEED_IDS.edie, SEED_IDS.vendorsA, {});
  grant(SEED_IDS.vic, SEED_IDS.ordersA, { export: true });

  store.payments.push(
    { id: newId(store), companyId: SEED_IDS.birch, submittedBy: SEED_IDS.bob, amount: 49, currency: "USD", months: 1, method: "Bank transfer", reference: "MOCK-TRF-0042", note: "Paid on the 3rd", status: "pending", reviewedBy: null, reviewedAt: null, reviewNote: null, createdAt: at(-2) },
    { id: newId(store), companyId: SEED_IDS.delta, submittedBy: SEED_IDS.dan, amount: 147, currency: "USD", months: 3, method: "Bank transfer", reference: "MOCK-TRF-0017", note: null, status: "approved", reviewedBy: SEED_IDS.founder, reviewedAt: at(-44), reviewNote: null, createdAt: at(-45) },
    { id: newId(store), companyId: SEED_IDS.cedar, submittedBy: SEED_IDS.carol, amount: 49, currency: "USD", months: 1, method: "Cash deposit", reference: "MOCK-DEP-0003", note: null, status: "rejected", reviewedBy: SEED_IDS.founder, reviewedAt: at(-20), reviewNote: "Amount did not match the invoice", createdAt: at(-21) },
  );

  log(SEED_IDS.acme, SEED_IDS.alice, "company.registered", 9, { name: "Acme Plywood Co" });
  log(SEED_IDS.acme, SEED_IDS.alice, "table.created", 8, { name: "Orders" });
  log(SEED_IDS.acme, SEED_IDS.alice, "member.added", 8, { employee_code: "EMP-0001" });
  log(SEED_IDS.birch, SEED_IDS.founder, "payment.submitted", 2, { amount: 49 });
  log(SEED_IDS.cedar, SEED_IDS.founder, "company.status_changed", 5, { status: "suspended", reason: "Chargeback dispute" });
  log(SEED_IDS.delta, SEED_IDS.founder, "payment.approved", 44, { months: 3 });

  // A longer list so founder pagination, search and filters have something to chew on.
  for (let i = 1; i <= 26; i++) {
    const uid = `00000000-0000-4000-8000-0000000fff${String(i).padStart(2, "0")}`;
    const cid = `00000000-0000-4000-8000-00000000f0${String(i).padStart(2, "0")}`;
    user(uid, `owner${i}@sample${i}.test`, `Owner ${i}`);
    company(cid, `Sample Company ${String(i).padStart(2, "0")}`, "active", 3 + i * 4);
    member(cid, uid, "admin", null, 3 + i * 4);
    const kind = i % 4;
    sub(cid, kind === 0
      ? { plan: "standard", status: "active", trialStartedAt: at(-90), trialEndsAt: at(-60), currentPeriodEnd: at(20 + i) }
      : kind === 1
        ? { plan: "trial", status: "trialing", trialStartedAt: at(-(3 + i)), trialEndsAt: at(27 - i > 0 ? 27 - i : 2), currentPeriodEnd: null }
        : kind === 2
          ? { plan: "trial", status: "trialing", trialStartedAt: at(-60), trialEndsAt: at(-30), currentPeriodEnd: null }
          : { plan: "trial", status: "trialing", trialStartedAt: at(-5), trialEndsAt: at(25), currentPeriodEnd: null });
  }

  store.settings.set("payment_instructions", "MOCK DATA: transfer to the account shown on your invoice and quote the reference. (Replace with real instructions in Founder settings.)");
  store.settings.set("support_email", "support@example.test");
  return store;
}

const g = globalThis as unknown as { __tdmMockStore?: MockStore };

/** The single in-memory store for this server process. */
export function getMockStore(): MockStore {
  if (!g.__tdmMockStore) g.__tdmMockStore = createSeededStore();
  return g.__tdmMockStore;
}

export function resetMockStore(): void {
  g.__tdmMockStore = createSeededStore();
}
