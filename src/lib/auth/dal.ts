import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import type { AppContext } from "@/lib/auth/context";
import { getBackend } from "@/lib/backend";
import { BackendError, type AuthUser } from "@/lib/backend/port";

// Data Access Layer. Every authorization decision in the app starts here and
// is derived from trusted server-side data: the auth provider (verified user)
// and the database (get_my_context). Nothing from the browser is believed.

/** Backend that is unreachable or misconfigured sends the user to a clear state, never a blank error. */
export async function guardUnavailable<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BackendError && error.kind === "unavailable") redirect("/unavailable");
    throw error;
  }
}

export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  return guardUnavailable(async () => (await getBackend()).auth.getUser());
});

export async function requireUser(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return user;
}

export const getContext = cache(async (): Promise<AppContext | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  const ctx = await guardUnavailable(async () => (await getBackend()).data.getContext());
  // The context must describe the same user the auth provider just verified.
  if (!ctx || ctx.userId !== user.id) return null;
  return ctx;
});

export async function requireContext(): Promise<AppContext> {
  const ctx = await getContext();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function requireFounder(): Promise<AppContext> {
  const ctx = await requireContext();
  if (!ctx.isFounder) redirect("/dashboard");
  return ctx;
}

export type CompanyContext = AppContext & { companyId: string; role: "admin" | "employee" };

/** A signed-in, active member of a company (any role). Founders and company-less users are redirected. */
export async function requireCompanyMember(): Promise<CompanyContext> {
  const ctx = await requireContext();
  if (ctx.isFounder) redirect("/founder");
  if (!ctx.companyId || !ctx.role) redirect("/onboarding");
  if (ctx.access === "disabled" || ctx.access === "suspended") redirect("/dashboard");
  return { ...ctx, companyId: ctx.companyId, role: ctx.role };
}

// Active company admin. Whether writes are currently allowed is `ctx.access === "full"`.
export async function requireCompanyAdmin(): Promise<AppContext & { companyId: string; role: "admin" }> {
  const ctx = await requireContext();
  if (ctx.isFounder || !ctx.companyId || ctx.role !== "admin" || ctx.memberStatus !== "active") {
    redirect("/dashboard");
  }
  return { ...ctx, companyId: ctx.companyId, role: "admin" };
}
