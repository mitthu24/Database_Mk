"use server";

import { createClient as createStatelessClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import { getAuthUser, requireUser } from "@/lib/auth/dal";
import {
  changePasswordSchema,
  companySchema,
  fieldErrorsFrom,
  friendlyAuthError,
  loginSchema,
  registerSchema,
  safeNextPath,
  type ActionState,
} from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

const GENERIC_ERROR = "Something went wrong. Please try again.";

function siteUrl() {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
}

function isConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

const NOT_CONFIGURED: ActionState = {
  message: "The server is not configured yet. Ask the administrator to complete the setup.",
};

export async function signIn(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  if (!isConfigured()) return NOT_CONFIGURED;

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Never distinguish "unknown email" from "wrong password".
    return { message: friendlyAuthError(error) };
  }

  redirect(safeNextPath(formData.get("next")));
}

export async function signUp(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  if (!isConfigured()) return NOT_CONFIGURED;

  const parsed = registerSchema.safeParse({
    fullName: formData.get("fullName"),
    companyName: formData.get("companyName"),
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const { fullName, companyName, email, password } = parsed.data;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Only descriptive values. Roles and company ids are never accepted from
      // signup metadata (the database trigger ignores everything but full_name).
      data: { full_name: fullName, pending_company_name: companyName },
      emailRedirectTo: `${siteUrl()}/auth/callback?next=/onboarding`,
    },
  });
  if (error) return { message: friendlyAuthError(error) };

  if (data.session) {
    // Email confirmation is disabled for this project: the user is signed in,
    // so the company can be created right away (atomic RPC).
    const { error: rpcError } = await supabase.rpc("register_company", { p_name: companyName });
    redirect(rpcError ? "/onboarding" : "/dashboard");
  }

  // Same response whether or not the address already has an account.
  return {
    ok: true,
    message: "Check your email to confirm your address. After confirming, you will finish creating your company.",
  };
}

export async function registerCompany(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  await requireUser(); // server-side re-verification, never trust the page

  const parsed = companySchema.safeParse({ companyName: formData.get("companyName") });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase.rpc("register_company", { p_name: parsed.data.companyName });

  if (error) {
    if (error.code === "23505") redirect("/dashboard"); // already belongs to a company
    if (error.code === "42501") {
      return { message: "Confirm your email address before creating a company." };
    }
    if (error.code === "22023") {
      return { fieldErrors: { companyName: ["Company name must be 2-120 characters."] } };
    }
    return { message: GENERIC_ERROR };
  }

  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function changePassword(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const user = await getAuthUser();
  if (!user?.email) redirect("/login");

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  // Re-authenticate with the CURRENT password on a throwaway client that keeps
  // no session, so the real session cookies are untouched by this check.
  const verifier = createStatelessClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
  );
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: user.email,
    password: parsed.data.currentPassword,
  });
  if (verifyError) {
    return verifyError.code === "invalid_credentials"
      ? { fieldErrors: { currentPassword: ["Current password is incorrect."] } }
      : { message: friendlyAuthError(verifyError) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });
  if (error) return { message: friendlyAuthError(error) };

  // Invalidate every other device/session that knew the old password.
  await supabase.auth.signOut({ scope: "others" });

  return { ok: true, message: "Password updated. Other devices have been signed out." };
}
