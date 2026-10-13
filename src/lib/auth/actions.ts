"use server";

import { redirect } from "next/navigation";

import { getAuthUser, requireUser } from "@/lib/auth/dal";
import {
  changePasswordSchema,
  companySchema,
  emailSchema,
  fieldErrorsFrom,
  friendlyAuthError,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  safeNextPath,
  type ActionState,
} from "@/lib/auth/validation";
import { getBackend, resolveBackendMode } from "@/lib/backend";
import { BackendError } from "@/lib/backend/port";
import { getSiteUrl } from "@/lib/supabase/config";

const GENERIC_ERROR = "Something went wrong. Please try again.";

function isConfigured() {
  const mode = resolveBackendMode();
  return mode.mode === "supabase" || mode.mode === "mock";
}

const NOT_CONFIGURED: ActionState = {
  message: "The server is not configured yet. Ask the administrator to complete the setup.",
};

async function unavailableSafe<T>(work: () => Promise<T>): Promise<T | typeof GENERIC_STATE> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof BackendError && error.kind === "unavailable") return GENERIC_STATE;
    throw error;
  }
}
const GENERIC_STATE: ActionState = { message: GENERIC_ERROR };

export async function signIn(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  if (!isConfigured()) return NOT_CONFIGURED;

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  return unavailableSafe(async () => {
    const backend = await getBackend();
    const result = await backend.auth.signInWithPassword(parsed.data.email, parsed.data.password);
    if (!result.ok) {
      // Never distinguish "unknown email" from "wrong password".
      return { message: friendlyAuthError(result.code) };
    }
    redirect(safeNextPath(formData.get("next")));
  });
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

  return unavailableSafe(async () => {
    const backend = await getBackend();
    const result = await backend.auth.signUp({
      email,
      password,
      fullName,
      companyName,
      redirectTo: `${getSiteUrl()}/auth/callback?next=/onboarding`,
    });
    if (!result.ok) return { message: friendlyAuthError(result.code) };

    if (result.sessionStarted) {
      // Email confirmation was not required (or this is the mock backend): the
      // user is signed in, so the company can be created right away.
      try {
        await backend.data.registerCompany(companyName);
      } catch {
        // Fall through to onboarding either way; the user can retry there.
      }
      redirect("/dashboard");
    }

    // Same response whether or not the address already has an account.
    return {
      ok: true,
      message: "Check your email to confirm your address. After confirming, you will finish creating your company.",
    };
  });
}

export async function registerCompany(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  await requireUser(); // server-side re-verification, never trust the page

  const parsed = companySchema.safeParse({ companyName: formData.get("companyName") });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  return unavailableSafe(async () => {
    const backend = await getBackend();
    try {
      await backend.data.registerCompany(parsed.data.companyName);
    } catch (error) {
      if (!(error instanceof BackendError)) throw error;
      if (error.kind === "conflict") redirect("/dashboard"); // already belongs to a company
      if (error.kind === "forbidden") return { message: "Confirm your email address before creating a company." };
      if (error.kind === "invalid") return { fieldErrors: { companyName: [error.message] } };
      return { message: GENERIC_ERROR };
    }
    redirect("/dashboard");
  });
}

export async function signOut() {
  const backend = await getBackend();
  await backend.auth.signOut();
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

  return unavailableSafe(async () => {
    const backend = await getBackend();

    // Re-authenticate with the CURRENT password without touching the real session.
    const verify = await backend.auth.verifyPassword(user.email!, parsed.data.currentPassword);
    if (!verify.ok) {
      return verify.code === "invalid_credentials"
        ? { fieldErrors: { currentPassword: ["Current password is incorrect."] } }
        : { message: friendlyAuthError(verify.code) };
    }

    const result = await backend.auth.updatePassword(parsed.data.newPassword);
    if (!result.ok) return { message: friendlyAuthError(result.code) };

    // Invalidate every other device/session that knew the old password.
    await backend.auth.signOut("others");

    return { ok: true, message: "Password updated. Other devices have been signed out." };
  });
}

export async function requestPasswordReset(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  if (!isConfigured()) return NOT_CONFIGURED;

  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { fieldErrors: { email: fieldErrorsFrom(parsed.error).email ?? ["Enter a valid email address."] } };

  return unavailableSafe(async () => {
    const backend = await getBackend();
    await backend.auth.requestPasswordReset(parsed.data, `${getSiteUrl()}/auth/callback?next=/account/password/reset`);
    // Always the same response: never reveal whether the address has an account.
    return { ok: true, message: "If that address has an account, a reset link has been sent." };
  });
}

export async function resetPassword(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  // The reset link's /auth/callback already exchanged the code for a session;
  // from here this acts on whoever that session belongs to.
  const user = await getAuthUser();
  if (!user) return { message: "That reset link has expired. Request a new one." };

  return unavailableSafe(async () => {
    const backend = await getBackend();
    const result = await backend.auth.updatePassword(parsed.data.newPassword);
    if (!result.ok) return { message: friendlyAuthError(result.code) };
    redirect("/dashboard");
  });
}

export async function resendConfirmation(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  if (!isConfigured()) return NOT_CONFIGURED;
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (!parsed.success) return { message: "Enter a valid email address." };

  return unavailableSafe(async () => {
    const backend = await getBackend();
    await backend.auth.resendConfirmation(parsed.data, `${getSiteUrl()}/auth/callback?next=/onboarding`);
    return { ok: true, message: "If that address needs confirming, a new link has been sent." };
  });
}
