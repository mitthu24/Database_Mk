import { z } from "zod";

import { parseContext } from "@/lib/auth/context";
import type {
  AuditEvent,
  CompanyProfile,
  FounderCompanyDetail,
  FounderCompanyRow,
  FounderOverview,
  Member,
  Page,
  Payment,
  PlatformSettings,
  TablePermission,
} from "@/lib/backend/types";
import { COLUMN_TYPES, type ImportJob, type ImportOutcome, type RowPage, type RowRecord, type TableSummary } from "@/lib/data/types";

// Shapes returned by the SQL functions in supabase/migrations/. Every adapter call
// parses the response, so a drifting database fails loudly instead of leaking
// malformed data into the UI. tests/fixtures/contracts/*.json are REAL outputs
// captured from the local PostgreSQL test run and are parsed by these schemas in
// tests/unit/contracts.test.ts.

const uuid = z.string().min(1);
const ts = z.string().min(1);
const nullableStr = z.string().nullable();

export const columnSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(COLUMN_TYPES),
  required: z.boolean().optional(),
});

const accessSchema = z.object({
  view: z.boolean(),
  create: z.boolean(),
  edit: z.boolean(),
  delete: z.boolean(),
  import: z.boolean(),
  export: z.boolean(),
  manage: z.boolean(),
});

export const tableSchema = z
  .object({
    id: uuid,
    name: z.string(),
    columns: z.array(columnSchema),
    row_count: z.number(),
    created_at: ts,
    updated_at: ts,
    data_updated_at: ts,
    access: accessSchema,
  })
  .transform(
    (t): TableSummary => ({
      id: t.id,
      name: t.name,
      columns: t.columns,
      rowCount: t.row_count,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
      dataUpdatedAt: t.data_updated_at,
      access: t.access,
    }),
  );

export const tableListSchema = z.array(tableSchema);

const rowDataSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

export const rowRecordSchema = z
  .object({ id: uuid, row_order: z.number(), data: rowDataSchema, created_at: ts, updated_at: ts })
  .transform((r): RowRecord => ({ id: r.id, rowOrder: r.row_order, data: r.data, createdAt: r.created_at, updatedAt: r.updated_at }));

export const rowPageSchema = z
  .object({ total: z.number(), offset: z.number(), limit: z.number(), rows: z.array(rowRecordSchema) })
  .transform((p): RowPage => p);

const issueSchema = z.object({ row: z.number(), message: z.string() });

export const importOutcomeSchema = z
  .union([
    z.object({ ok: z.literal(true), job_id: uuid, mode: z.enum(["append", "replace"]), inserted: z.number(), deleted: z.number() }),
    z.object({ ok: z.literal(false), job_id: uuid, error_count: z.number(), errors: z.array(issueSchema) }),
  ])
  .transform((o): ImportOutcome =>
    o.ok
      ? { ok: true, jobId: o.job_id, mode: o.mode, inserted: o.inserted, deleted: o.deleted }
      : { ok: false, jobId: o.job_id, errorCount: o.error_count, errors: o.errors },
  );

export const importJobsSchema = z
  .array(
    z.object({
      id: uuid,
      table_id: z.string().nullable(),
      table_name: z.string(),
      mode: z.enum(["append", "replace"]),
      file_name: nullableStr,
      status: z.enum(["succeeded", "failed"]),
      rows_received: z.number(),
      rows_inserted: z.number(),
      rows_deleted: z.number(),
      error_summary: z.object({ error_count: z.number().optional(), errors: z.array(issueSchema).optional() }).passthrough(),
      created_by: z.string().nullable(),
      created_at: ts,
    }),
  )
  .transform((jobs): ImportJob[] =>
    jobs.map((j) => ({
      id: j.id,
      tableId: j.table_id,
      tableName: j.table_name,
      mode: j.mode,
      fileName: j.file_name,
      status: j.status,
      rowsReceived: j.rows_received,
      rowsInserted: j.rows_inserted,
      rowsDeleted: j.rows_deleted,
      errorCount: j.error_summary.error_count ?? 0,
      errors: j.error_summary.errors ?? [],
      createdBy: j.created_by,
      createdAt: j.created_at,
    })),
  );

export const companyProfileSchema = z
  .object({
    id: uuid,
    name: z.string(),
    status: z.enum(["active", "suspended"]),
    contact_email: nullableStr,
    phone: nullableStr,
    address: nullableStr,
    created_at: ts,
  })
  .transform(
    (c): CompanyProfile => ({
      id: c.id,
      name: c.name,
      status: c.status,
      contactEmail: c.contact_email,
      phone: c.phone,
      address: c.address,
      createdAt: c.created_at,
    }),
  );

export const memberSchema = z
  .object({
    id: uuid,
    user_id: uuid,
    role: z.enum(["admin", "employee"]),
    status: z.enum(["active", "disabled"]),
    employee_code: nullableStr,
    created_at: ts,
    email: nullableStr,
    full_name: nullableStr,
    tables_with_access: z.number(),
  })
  .transform(
    (m): Member => ({
      id: m.id,
      userId: m.user_id,
      role: m.role,
      status: m.status,
      employeeCode: m.employee_code,
      createdAt: m.created_at,
      email: m.email,
      fullName: m.full_name,
      tablesWithAccess: m.tables_with_access,
    }),
  );
export const memberListSchema = z.array(memberSchema);

export const permissionListSchema = z
  .array(
    z.object({
      user_id: uuid,
      table_id: uuid,
      table_name: z.string(),
      can_view: z.boolean(),
      can_create: z.boolean(),
      can_edit: z.boolean(),
      can_delete: z.boolean(),
      can_import: z.boolean(),
      can_export: z.boolean(),
    }),
  )
  .transform((rows): TablePermission[] =>
    rows.map((p) => ({
      userId: p.user_id,
      tableId: p.table_id,
      tableName: p.table_name,
      canView: p.can_view,
      canCreate: p.can_create,
      canEdit: p.can_edit,
      canDelete: p.can_delete,
      canImport: p.can_import,
      canExport: p.can_export,
    })),
  );

const auditRowSchema = z
  .object({
    id: z.number(),
    created_at: ts,
    action: z.string(),
    target_type: nullableStr,
    target_id: nullableStr,
    metadata: z.record(z.string(), z.unknown()),
    actor_id: nullableStr,
    actor_email: nullableStr.optional(),
    company_id: nullableStr.optional(),
    company_name: nullableStr.optional(),
  })
  .transform(
    (a): AuditEvent => ({
      id: a.id,
      createdAt: a.created_at,
      action: a.action,
      targetType: a.target_type,
      targetId: a.target_id,
      metadata: a.metadata,
      actorId: a.actor_id,
      actorEmail: a.actor_email ?? null,
      companyId: a.company_id ?? null,
      companyName: a.company_name ?? null,
    }),
  );

export const auditPageSchema = z
  .object({ total: z.number(), rows: z.array(auditRowSchema) })
  .transform((p): Page<AuditEvent> => p);

export const paymentSchema = z
  .object({
    id: uuid,
    company_id: uuid,
    amount: z.number(),
    currency: z.string(),
    months: z.number(),
    method: z.string(),
    reference: z.string(),
    note: nullableStr,
    status: z.enum(["pending", "approved", "rejected"]),
    review_note: nullableStr,
    reviewed_at: nullableStr,
    created_at: ts,
    company_name: nullableStr.optional(),
    submitted_by_email: nullableStr.optional(),
  })
  .transform(
    (p): Payment => ({
      id: p.id,
      companyId: p.company_id,
      amount: p.amount,
      currency: p.currency,
      months: p.months,
      method: p.method,
      reference: p.reference,
      note: p.note,
      status: p.status,
      reviewNote: p.review_note,
      reviewedAt: p.reviewed_at,
      createdAt: p.created_at,
      companyName: p.company_name ?? null,
      submittedByEmail: p.submitted_by_email ?? null,
    }),
  );
export const paymentListSchema = z.array(paymentSchema);
export const paymentPageSchema = z.object({ total: z.number(), rows: z.array(paymentSchema) }).transform((p): Page<Payment> => p);

export const settingsSchema = z
  .record(z.string(), z.string())
  .transform((s): PlatformSettings => ({
    payment_instructions: s.payment_instructions,
    support_email: s.support_email,
    plan_price_text: s.plan_price_text,
  }));

const accessEnum = z.enum(["full", "read_only", "suspended"]);
const subStatus = z.enum(["trialing", "active", "past_due", "canceled"]).nullable();

export const founderOverviewSchema = z
  .object({
    companies_total: z.number(),
    suspended: z.number(),
    trialing: z.number(),
    active_paid: z.number(),
    expired: z.number(),
    trials_ending_7d: z.number(),
    members_total: z.number(),
    tables_total: z.number(),
    rows_total: z.number(),
    payments_pending: z.number(),
    payments_approved_30d: z.array(z.object({ currency: z.string(), total: z.number() })),
    signups_by_month: z.array(z.object({ month: z.string(), count: z.number() })),
  })
  .transform(
    (o): FounderOverview => ({
      companiesTotal: o.companies_total,
      suspended: o.suspended,
      trialing: o.trialing,
      activePaid: o.active_paid,
      expired: o.expired,
      trialsEnding7d: o.trials_ending_7d,
      membersTotal: o.members_total,
      tablesTotal: o.tables_total,
      rowsTotal: o.rows_total,
      paymentsPending: o.payments_pending,
      paymentsApproved30d: o.payments_approved_30d,
      signupsByMonth: o.signups_by_month,
    }),
  );

export const founderCompanyPageSchema = z
  .object({
    total: z.number(),
    offset: z.number(),
    limit: z.number(),
    rows: z.array(
      z.object({
        id: uuid,
        name: z.string(),
        status: z.enum(["active", "suspended"]),
        created_at: ts,
        plan: nullableStr,
        subscription_status: subStatus,
        trial_ends_at: nullableStr,
        current_period_end: nullableStr,
        access: accessEnum,
        members: z.number(),
        tables: z.number(),
        admin_email: nullableStr,
      }),
    ),
  })
  .transform(
    (p): Page<FounderCompanyRow> => ({
      total: p.total,
      rows: p.rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        createdAt: r.created_at,
        plan: r.plan,
        subscriptionStatus: r.subscription_status,
        trialEndsAt: r.trial_ends_at,
        currentPeriodEnd: r.current_period_end,
        access: r.access,
        members: r.members,
        tables: r.tables,
        adminEmail: r.admin_email,
      })),
    }),
  );

export const founderCompanyDetailSchema = z
  .object({
    id: uuid,
    name: z.string(),
    status: z.enum(["active", "suspended"]),
    created_at: ts,
    contact_email: nullableStr,
    phone: nullableStr,
    address: nullableStr,
    access: accessEnum,
    subscription: z.object({
      plan: nullableStr,
      status: subStatus,
      trial_started_at: nullableStr,
      trial_ends_at: nullableStr,
      current_period_end: nullableStr,
    }),
    members: z.number(),
    tables: z.number(),
    rows: z.number(),
    payments: z.array(paymentSchema),
  })
  .transform(
    (d): FounderCompanyDetail => ({
      id: d.id,
      name: d.name,
      status: d.status,
      createdAt: d.created_at,
      contactEmail: d.contact_email,
      phone: d.phone,
      address: d.address,
      access: d.access,
      subscription: {
        plan: d.subscription.plan,
        status: d.subscription.status,
        trialStartedAt: d.subscription.trial_started_at,
        trialEndsAt: d.subscription.trial_ends_at,
        currentPeriodEnd: d.subscription.current_period_end,
      },
      members: d.members,
      tables: d.tables,
      rows: d.rows,
      payments: d.payments,
    }),
  );

export const contextSchema = z.unknown().transform((raw) => parseContext(raw));
export const companyIdSchema = z.object({ company_id: uuid }).transform((o) => o.company_id);
export const tableOrNullSchema = z.union([tableSchema, z.null()]);
