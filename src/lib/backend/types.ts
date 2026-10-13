import type { ColumnDef } from "@/lib/data/types";

export interface CompanyProfile {
  id: string;
  name: string;
  status: "active" | "suspended";
  contactEmail: string | null;
  phone: string | null;
  address: string | null;
  createdAt: string;
}

export interface CompanyProfileInput {
  name: string;
  contactEmail: string;
  phone: string;
  address: string;
}

export interface Member {
  id: string;
  userId: string;
  role: "admin" | "employee";
  status: "active" | "disabled";
  employeeCode: string | null;
  createdAt: string;
  email: string | null;
  fullName: string | null;
  tablesWithAccess: number;
}

export interface PermissionFlags {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  import: boolean;
  export: boolean;
}

export interface TablePermission {
  userId: string;
  tableId: string;
  tableName: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canImport: boolean;
  canExport: boolean;
}

export interface AuditEvent {
  id: number;
  createdAt: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: Record<string, unknown>;
  actorId: string | null;
  actorEmail: string | null;
  companyId: string | null;
  companyName: string | null;
}

export interface AuditQuery {
  companyId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

export interface Page<T> {
  total: number;
  rows: T[];
}

export type PaymentStatus = "pending" | "approved" | "rejected";

export interface Payment {
  id: string;
  companyId: string;
  amount: number;
  currency: string;
  months: number;
  method: string;
  reference: string;
  note: string | null;
  status: PaymentStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  companyName: string | null;
  submittedByEmail: string | null;
}

export interface PaymentInput {
  amount: number;
  currency: string;
  months: number;
  method: string;
  reference: string;
  note: string;
}

export type SettingKey = "payment_instructions" | "support_email" | "plan_price_text";
export type PlatformSettings = Partial<Record<SettingKey, string>>;

export type CompanyState = "all" | "trialing" | "active" | "expired" | "suspended";
export type CompanyAccess = "full" | "read_only" | "suspended";

export interface FounderOverview {
  companiesTotal: number;
  suspended: number;
  trialing: number;
  activePaid: number;
  expired: number;
  trialsEnding7d: number;
  membersTotal: number;
  tablesTotal: number;
  rowsTotal: number;
  paymentsPending: number;
  paymentsApproved30d: { currency: string; total: number }[];
  signupsByMonth: { month: string; count: number }[];
}

export interface FounderCompanyRow {
  id: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string;
  plan: string | null;
  subscriptionStatus: "trialing" | "active" | "past_due" | "canceled" | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  access: CompanyAccess;
  members: number;
  tables: number;
  adminEmail: string | null;
}

export interface FounderCompanyQuery {
  search?: string;
  state?: CompanyState;
  limit?: number;
  offset?: number;
}

export interface FounderCompanyDetail {
  id: string;
  name: string;
  status: "active" | "suspended";
  createdAt: string;
  contactEmail: string | null;
  phone: string | null;
  address: string | null;
  access: CompanyAccess;
  subscription: {
    plan: string | null;
    status: "trialing" | "active" | "past_due" | "canceled" | null;
    trialStartedAt: string | null;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
  };
  members: number;
  tables: number;
  rows: number;
  payments: Payment[];
}

export type { ColumnDef };
