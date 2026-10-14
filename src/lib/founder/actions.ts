"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireFounder } from "@/lib/auth/dal";
import { fieldErrorsFrom, personNameSchema, type ActionState } from "@/lib/auth/validation";
import { getBackend } from "@/lib/backend";
import { BackendError } from "@/lib/backend/port";
import type { SettingKey } from "@/lib/backend/types";

const GENERIC_ERROR = "Something went wrong. Please try again.";

function toMessage(error: unknown): string {
  return error instanceof BackendError ? error.message : GENERIC_ERROR;
}

export async function setCompanyStatus(companyId: string, status: "active" | "suspended", reason?: string) {
  await requireFounder();
  try {
    const backend = await getBackend();
    await backend.data.founderSetCompanyStatus(companyId, status, reason);
    revalidatePath(`/founder/companies/${companyId}`);
    revalidatePath("/founder/companies");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: toMessage(error) };
  }
}

export async function setSubscription(companyId: string, status: "trialing" | "past_due" | "canceled", trialEndsAt?: string) {
  await requireFounder();
  try {
    const backend = await getBackend();
    await backend.data.founderSetSubscription(companyId, { status, trialEndsAt });
    revalidatePath(`/founder/companies/${companyId}`);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: toMessage(error) };
  }
}

export async function reviewPayment(paymentId: string, decision: "approve" | "reject", note?: string) {
  await requireFounder();
  if (decision === "reject" && !note?.trim()) {
    return { ok: false as const, message: "A reason is required to reject a payment." };
  }
  try {
    const backend = await getBackend();
    const payment = await backend.data.founderReviewPayment(paymentId, decision, note);
    revalidatePath("/founder/payments");
    revalidatePath(`/founder/companies/${payment.companyId}`);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: toMessage(error) };
  }
}

const createCompanySchema = z.object({
  companyName: personNameSchema,
  email: z.email("Enter a valid email address.").max(254),
  fullName: personNameSchema,
});

export async function createCompany(_prev: ActionState | undefined, formData: FormData): Promise<ActionState & { companyId?: string }> {
  await requireFounder();
  const parsed = createCompanySchema.safeParse({
    companyName: formData.get("companyName"),
    email: formData.get("email"),
    fullName: formData.get("fullName"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  const backend = await getBackend();
  const invited = await backend.authAdmin.inviteUser({ email: parsed.data.email, fullName: parsed.data.fullName, redirectTo: "/dashboard" });
  if (!invited.ok) {
    return { fieldErrors: { email: ["Could not invite that email address. It may already have an account."] } };
  }

  try {
    const companyId = await backend.data.founderCreateCompany(invited.userId, parsed.data.companyName);
    revalidatePath("/founder/companies");
    return { ok: true, companyId };
  } catch (error) {
    await backend.authAdmin.deleteUser(invited.userId);
    if (error instanceof BackendError && error.kind === "conflict") return { fieldErrors: { companyName: [error.message] } };
    return { message: toMessage(error) };
  }
}

export async function updatePlatformSetting(key: SettingKey, value: string) {
  await requireFounder();
  try {
    const backend = await getBackend();
    await backend.data.founderUpdateSetting(key, value);
    revalidatePath("/founder/settings");
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: toMessage(error) };
  }
}
