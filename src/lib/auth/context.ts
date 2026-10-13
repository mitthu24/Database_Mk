import { z } from "zod";

// Shape returned by public.get_my_context(). Parsed (never trusted blindly) so
// a schema drift fails closed instead of granting access.
const contextSchema = z.object({
  user_id: z.string(),
  is_founder: z.boolean(),
  company_id: z.string().nullable(),
  company_name: z.string().nullable(),
  company_status: z.enum(["active", "suspended"]).nullable(),
  role: z.enum(["admin", "employee"]).nullable(),
  member_status: z.enum(["active", "disabled"]).nullable(),
  plan: z.string().nullable(),
  subscription_status: z.enum(["trialing", "active", "past_due", "canceled"]).nullable(),
  trial_ends_at: z.string().nullable(),
  current_period_end: z.string().nullable(),
  access: z.enum(["none", "disabled", "suspended", "read_only", "full"]),
});

export type AppContext = {
  userId: string;
  isFounder: boolean;
  companyId: string | null;
  companyName: string | null;
  companyStatus: "active" | "suspended" | null;
  role: "admin" | "employee" | null;
  memberStatus: "active" | "disabled" | null;
  plan: string | null;
  subscriptionStatus: "trialing" | "active" | "past_due" | "canceled" | null;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  access: "none" | "disabled" | "suspended" | "read_only" | "full";
};

export function parseContext(raw: unknown): AppContext | null {
  const parsed = contextSchema.safeParse(raw);
  if (!parsed.success) return null;
  const c = parsed.data;
  return {
    userId: c.user_id,
    isFounder: c.is_founder,
    companyId: c.company_id,
    companyName: c.company_name,
    companyStatus: c.company_status,
    role: c.role,
    memberStatus: c.member_status,
    plan: c.plan,
    subscriptionStatus: c.subscription_status,
    trialEndsAt: c.trial_ends_at ? new Date(c.trial_ends_at) : null,
    currentPeriodEnd: c.current_period_end ? new Date(c.current_period_end) : null,
    access: c.access,
  };
}

export function trialDaysLeft(ctx: AppContext, now: Date): number | null {
  if (ctx.subscriptionStatus !== "trialing" || !ctx.trialEndsAt) return null;
  const ms = ctx.trialEndsAt.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
