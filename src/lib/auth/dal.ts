import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { parseContext, type AppContext } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

// Data Access Layer. Every authorization decision in the app starts here and
// is derived from trusted server-side data: the Supabase Auth server (getUser)
// and the database (get_my_context). Nothing from the browser is believed.

export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
});

export async function requireUser() {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return user;
}

export const getContext = cache(async (): Promise<AppContext | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_my_context");
  if (error) return null;

  const ctx = parseContext(data);
  // The context must describe the same user the Auth server just verified.
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

// Active company admin whose company is allowed to perform writes.
export async function requireCompanyAdmin(): Promise<
  AppContext & { companyId: string; role: "admin" }
> {
  const ctx = await requireContext();
  if (ctx.isFounder || !ctx.companyId || ctx.role !== "admin" || ctx.memberStatus !== "active") {
    redirect("/dashboard");
  }
  return { ...ctx, companyId: ctx.companyId, role: "admin" };
}
