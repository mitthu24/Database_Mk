import type { AppContext } from "@/lib/auth/context";
import type {
  AuditEvent,
  AuditQuery,
  CompanyProfile,
  CompanyProfileInput,
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
import type {
  ColumnDef,
  ImportJob,
  ImportMode,
  ImportOutcome,
  RowData,
  RowPage,
  RowQuery,
  RowRecord,
  TableSummary,
} from "@/lib/data/types";

// ---- errors -------------------------------------------------------------------------

export type BackendErrorKind =
  | "forbidden" // not allowed (also used for "not found" on other tenants' ids, by design)
  | "not_found"
  | "conflict" // duplicate
  | "invalid" // input rejected by validation
  | "limit" // quota / rate style limit
  | "unavailable" // backend unreachable or misconfigured
  | "unknown";

export class BackendError extends Error {
  constructor(
    public readonly kind: BackendErrorKind,
    /** Safe to show to the user. */
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "BackendError";
  }
}

// ---- auth -----------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  email: string | null;
  emailConfirmed: boolean;
  fullName: string | null;
  pendingCompanyName: string | null;
}

export type AuthErrorCode =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "weak_password"
  | "same_password"
  | "session_required"
  | "unavailable"
  | "unknown";

export type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode };

export interface AuthPort {
  getUser(): Promise<AuthUser | null>;
  signInWithPassword(email: string, password: string): Promise<AuthResult>;
  signUp(input: {
    email: string;
    password: string;
    fullName: string;
    companyName: string;
    redirectTo: string;
  }): Promise<{ ok: true; sessionStarted: boolean } | { ok: false; code: AuthErrorCode }>;
  signOut(scope?: "local" | "others"): Promise<void>;
  /** Re-authentication: checks a password WITHOUT touching the current session. */
  verifyPassword(email: string, password: string): Promise<AuthResult>;
  updatePassword(newPassword: string): Promise<AuthResult>;
  requestPasswordReset(email: string, redirectTo: string): Promise<AuthResult>;
  exchangeCode(code: string): Promise<boolean>;
  resendConfirmation(email: string, redirectTo: string): Promise<AuthResult>;
}

/** Operations that need the Auth admin API. Server-only; never reachable from the browser. */
export interface AuthAdminPort {
  inviteUser(input: { email: string; fullName: string; redirectTo: string }): Promise<{ ok: true; userId: string } | { ok: false; code: AuthErrorCode }>;
  deleteUser(userId: string): Promise<void>;
}

// ---- data -------------------------------------------------------------------------------

export interface DataPort {
  // context & profile
  getContext(): Promise<AppContext | null>;
  getCompanyProfile(): Promise<CompanyProfile | null>;
  updateCompanyProfile(input: CompanyProfileInput): Promise<CompanyProfile>;
  updateMyProfile(fullName: string): Promise<void>;
  registerCompany(name: string): Promise<string>;

  // logical tables
  listTables(): Promise<TableSummary[]>;
  getTable(id: string): Promise<TableSummary | null>;
  createTable(name: string, columns: ColumnDef[]): Promise<TableSummary>;
  renameTable(id: string, name: string): Promise<TableSummary>;
  updateTableSchema(id: string, columns: ColumnDef[]): Promise<TableSummary>;
  clearTable(id: string): Promise<number>;
  dropTable(id: string): Promise<void>;

  // rows
  queryRows(tableId: string, query?: RowQuery): Promise<RowPage>;
  insertRow(tableId: string, data: RowData): Promise<RowRecord>;
  updateRow(tableId: string, rowId: string, data: RowData): Promise<RowRecord>;
  deleteRows(tableId: string, rowIds: string[]): Promise<number>;

  // import / export
  importRows(tableId: string, mode: ImportMode, rows: RowData[], fileName: string | null): Promise<ImportOutcome>;
  listImportJobs(tableId?: string, limit?: number): Promise<ImportJob[]>;
  /** MUST be called (and succeed) before streaming any export. */
  authorizeExport(tableId: string): Promise<void>;

  // members & permissions
  listMembers(): Promise<Member[]>;
  addMember(userId: string, employeeCode?: string): Promise<Member>;
  setMemberStatus(memberId: string, status: "active" | "disabled"): Promise<Member>;
  setMemberRole(memberId: string, role: "admin" | "employee"): Promise<Member>;
  setMemberCode(memberId: string, code: string): Promise<Member>;
  listPermissions(userId?: string): Promise<TablePermission[]>;
  setTablePermission(userId: string, tableId: string, flags: PermissionFlags): Promise<void>;
  listCompanyAudit(query?: AuditQuery): Promise<Page<AuditEvent>>;

  // billing
  listPayments(): Promise<Payment[]>;
  submitPayment(input: PaymentInput): Promise<Payment>;
  getPlatformSettings(): Promise<PlatformSettings>;

  // founder
  founderOverview(): Promise<FounderOverview>;
  founderListCompanies(query?: FounderCompanyQuery): Promise<Page<FounderCompanyRow>>;
  founderCompanyDetail(companyId: string): Promise<FounderCompanyDetail>;
  founderListMembers(companyId: string): Promise<Member[]>;
  founderListPayments(status?: PaymentStatus, limit?: number, offset?: number): Promise<Page<Payment>>;
  founderReviewPayment(paymentId: string, decision: "approve" | "reject", note?: string): Promise<Payment>;
  founderAudit(query?: AuditQuery): Promise<Page<AuditEvent>>;
  founderSetCompanyStatus(companyId: string, status: "active" | "suspended", reason?: string): Promise<void>;
  founderSetSubscription(companyId: string, change: { status: "trialing" | "past_due" | "canceled"; trialEndsAt?: string }): Promise<void>;
  founderCreateCompany(adminUserId: string, name: string): Promise<string>;
  founderUpdateSetting(key: SettingKey, value: string): Promise<void>;
}

export interface Backend {
  readonly kind: "supabase" | "mock";
  readonly auth: AuthPort;
  readonly data: DataPort;
  /** Present only where a trusted server may use it (service-role / mock). */
  readonly authAdmin: AuthAdminPort;
}
