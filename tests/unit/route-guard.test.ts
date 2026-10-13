import { describe, expect, it } from "vitest";

import { isProtectedPath, resolveGuard } from "@/lib/auth/route-guard";

const base = { supabaseConfigured: true };

describe("resolveGuard", () => {
  it("sends unauthenticated users on protected paths to login, preserving the target", () => {
    expect(resolveGuard({ ...base, pathname: "/dashboard", isAuthenticated: false })).toEqual({
      action: "redirect",
      to: "/login?next=%2Fdashboard",
    });
    expect(resolveGuard({ ...base, pathname: "/founder", isAuthenticated: false })).toEqual({
      action: "redirect",
      to: "/login?next=%2Ffounder",
    });
  });

  it("protects nested paths but not look-alike prefixes", () => {
    expect(isProtectedPath("/account/password")).toBe(true);
    expect(isProtectedPath("/dashboard/anything/deep")).toBe(true);
    expect(isProtectedPath("/dashboardx")).toBe(false);
    expect(isProtectedPath("/founders-club")).toBe(false);
  });

  it("lets authenticated users through protected paths", () => {
    expect(resolveGuard({ ...base, pathname: "/dashboard", isAuthenticated: true })).toEqual({ action: "next" });
  });

  it("bounces authenticated users away from login/register", () => {
    expect(resolveGuard({ ...base, pathname: "/login", isAuthenticated: true })).toEqual({
      action: "redirect",
      to: "/dashboard",
    });
    expect(resolveGuard({ ...base, pathname: "/register", isAuthenticated: true })).toEqual({
      action: "redirect",
      to: "/dashboard",
    });
  });

  it("leaves public pages alone", () => {
    for (const pathname of ["/", "/login", "/register", "/setup", "/auth/callback"]) {
      expect(resolveGuard({ ...base, pathname, isAuthenticated: false })).toEqual({ action: "next" });
    }
  });

  it("falls back to /setup when Supabase is not configured", () => {
    expect(
      resolveGuard({ pathname: "/dashboard", isAuthenticated: false, supabaseConfigured: false }),
    ).toEqual({ action: "redirect", to: "/setup" });
    expect(
      resolveGuard({ pathname: "/setup", isAuthenticated: false, supabaseConfigured: false }),
    ).toEqual({ action: "next" });
  });
});
