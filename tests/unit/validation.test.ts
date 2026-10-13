import { describe, expect, it } from "vitest";

import {
  changePasswordSchema,
  employeeSchema,
  friendlyAuthError,
  loginSchema,
  registerSchema,
  safeNextPath,
} from "@/lib/auth/validation";

describe("safeNextPath (open-redirect protection)", () => {
  it("accepts same-origin relative paths", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/account/password?x=1")).toBe("/account/password?x=1");
  });

  it.each([
    "//evil.com",
    "///evil.com",
    "https://evil.com",
    "http://evil.com/x",
    "javascript:alert(1)",
    "/\\evil.com",
    "\\\\evil.com",
    "dashboard",
    "",
    "/ok\nSet-Cookie: a=b",
    "/ok\u0000",
  ])("rejects %j", (value) => {
    expect(safeNextPath(value)).toBe("/dashboard");
  });

  it("rejects non-strings and auth loops", () => {
    expect(safeNextPath(undefined)).toBe("/dashboard");
    expect(safeNextPath(["/dashboard"])).toBe("/dashboard");
    expect(safeNextPath("/login")).toBe("/dashboard");
    expect(safeNextPath("/auth/callback?code=x")).toBe("/dashboard");
    expect(safeNextPath("/" + "a".repeat(600))).toBe("/dashboard");
  });

  it("honours a custom fallback", () => {
    expect(safeNextPath("//evil.com", "/onboarding")).toBe("/onboarding");
  });
});

describe("loginSchema", () => {
  it("normalizes the email", () => {
    const r = loginSchema.parse({ email: "  Admin@Example.COM ", password: "x" });
    expect(r.email).toBe("admin@example.com");
  });
  it("rejects bad email and empty password", () => {
    expect(loginSchema.safeParse({ email: "nope", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.co", password: "" }).success).toBe(false);
  });
});

describe("registerSchema", () => {
  const valid = {
    fullName: "Ada Lovelace",
    companyName: "Acme Plywood",
    email: "ada@example.com",
    password: "a-long-password",
  };

  it("accepts valid input", () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it("enforces password length (10..72)", () => {
    expect(registerSchema.safeParse({ ...valid, password: "short" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: "nine-char" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: "x".repeat(73) }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, password: "x".repeat(72) }).success).toBe(true);
  });

  it("requires names of 2-120 characters", () => {
    expect(registerSchema.safeParse({ ...valid, companyName: " a " }).success).toBe(false);
    expect(registerSchema.safeParse({ ...valid, fullName: "x".repeat(121) }).success).toBe(false);
  });

  it("strips unknown fields such as role, company_id or trial dates", () => {
    const parsed = registerSchema.parse({
      ...valid,
      role: "founder",
      company_id: "00000000-0000-0000-0000-000000000000",
      trial_ends_at: "2099-01-01",
    });
    expect(Object.keys(parsed).sort()).toEqual(["companyName", "email", "fullName", "password"]);
  });
});

describe("changePasswordSchema", () => {
  const ok = { currentPassword: "old-password-1", newPassword: "new-password-22", confirmPassword: "new-password-22" };

  it("accepts a valid change", () => {
    expect(changePasswordSchema.safeParse(ok).success).toBe(true);
  });
  it("requires matching confirmation", () => {
    const r = changePasswordSchema.safeParse({ ...ok, confirmPassword: "different-pass-9" });
    expect(r.success).toBe(false);
  });
  it("rejects reusing the current password", () => {
    const r = changePasswordSchema.safeParse({ ...ok, newPassword: ok.currentPassword, confirmPassword: ok.currentPassword });
    expect(r.success).toBe(false);
  });
  it("enforces minimum length on the new password", () => {
    const r = changePasswordSchema.safeParse({ ...ok, newPassword: "short", confirmPassword: "short" });
    expect(r.success).toBe(false);
  });
});

describe("employeeSchema", () => {
  it("ignores client-supplied company_id and role", () => {
    const parsed = employeeSchema.parse({
      email: "emp@example.com",
      fullName: "Emp Loyee",
      company_id: "11111111-1111-1111-1111-111111111111",
      role: "admin",
    });
    expect(parsed).toEqual({ email: "emp@example.com", fullName: "Emp Loyee" });
  });
  it("validates employee codes", () => {
    expect(employeeSchema.safeParse({ email: "e@x.co", fullName: "Ab", employeeCode: "EMP-001" }).success).toBe(true);
    expect(employeeSchema.safeParse({ email: "e@x.co", fullName: "Ab", employeeCode: "bad code!" }).success).toBe(false);
  });
});

describe("friendlyAuthError", () => {
  it("never leaks provider messages", () => {
    expect(friendlyAuthError("invalid_credentials")).toBe("Invalid email or password.");
    expect(friendlyAuthError("unknown")).toBe("Something went wrong. Please try again.");
    expect(friendlyAuthError(null)).toBe("Something went wrong. Please try again.");
  });
  it("maps rate limits", () => {
    expect(friendlyAuthError("rate_limited")).toMatch(/Too many attempts/);
  });
});
