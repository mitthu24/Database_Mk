import { describe, expect, it } from "vitest";

import { parseContext, trialDaysLeft } from "@/lib/auth/context";

// Keys must match public.get_my_context() — also asserted in tests/db/70_api_surface_audit.sql.
const sample = {
  user_id: "a0000000-0000-0000-0000-000000000001",
  is_founder: false,
  company_id: "b0000000-0000-0000-0000-000000000001",
  company_name: "Acme Plywood",
  company_status: "active",
  role: "admin",
  member_status: "active",
  plan: "trial",
  subscription_status: "trialing",
  trial_ends_at: "2026-11-12T00:00:00+00:00",
  current_period_end: null,
  access: "full",
};

describe("parseContext", () => {
  it("parses a valid context", () => {
    const ctx = parseContext(sample);
    expect(ctx).not.toBeNull();
    expect(ctx?.role).toBe("admin");
    expect(ctx?.trialEndsAt).toBeInstanceOf(Date);
  });

  it("parses a user with no company", () => {
    const ctx = parseContext({
      ...sample,
      company_id: null,
      company_name: null,
      company_status: null,
      role: null,
      member_status: null,
      plan: null,
      subscription_status: null,
      trial_ends_at: null,
      access: "none",
    });
    expect(ctx?.access).toBe("none");
    expect(ctx?.companyId).toBeNull();
  });

  it("fails closed on unknown roles, unknown access levels, missing keys and non-objects", () => {
    expect(parseContext({ ...sample, role: "superuser" })).toBeNull();
    expect(parseContext({ ...sample, access: "god" })).toBeNull();
    const { access: _omitted, ...withoutAccess } = sample;
    void _omitted;
    expect(parseContext(withoutAccess)).toBeNull();
    expect(parseContext(null)).toBeNull();
    expect(parseContext("admin")).toBeNull();
  });
});

describe("trialDaysLeft", () => {
  const ctx = parseContext(sample)!;

  it("counts whole days remaining, rounding up", () => {
    expect(trialDaysLeft(ctx, new Date("2026-11-11T12:00:00Z"))).toBe(1);
    expect(trialDaysLeft(ctx, new Date("2026-10-13T00:00:00Z"))).toBe(30);
  });

  it("never goes negative", () => {
    expect(trialDaysLeft(ctx, new Date("2027-01-01T00:00:00Z"))).toBe(0);
  });

  it("is null when not trialing", () => {
    const paid = parseContext({ ...sample, subscription_status: "active" })!;
    expect(trialDaysLeft(paid, new Date("2026-10-13T00:00:00Z"))).toBeNull();
  });
});
