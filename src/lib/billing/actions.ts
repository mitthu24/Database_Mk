"use server";

import { revalidatePath } from "next/cache";

import { requireCompanyAdmin } from "@/lib/auth/dal";
import { fieldErrorsFrom, type ActionState } from "@/lib/auth/validation";
import { getBackend } from "@/lib/backend";
import { BackendError } from "@/lib/backend/port";
import { paymentSchema } from "@/lib/billing/validation";

const GENERIC_ERROR = "Something went wrong. Please try again.";

export async function submitPayment(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  await requireCompanyAdmin();

  const parsed = paymentSchema.safeParse({
    amount: formData.get("amount"),
    currency: formData.get("currency"),
    months: formData.get("months"),
    method: formData.get("method"),
    reference: formData.get("reference"),
    note: formData.get("note"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    const backend = await getBackend();
    await backend.data.submitPayment(parsed.data);
  } catch (error) {
    if (error instanceof BackendError) {
      if (error.kind === "forbidden") return { message: "This company cannot submit a payment right now." };
      if (error.kind === "conflict") return { fieldErrors: { reference: [error.message] } };
      if (error.kind === "limit") return { message: error.message };
      if (error.kind === "invalid") return { message: error.message };
      return { message: error.message };
    }
    return { message: GENERIC_ERROR };
  }
  revalidatePath("/company/billing");
  return { ok: true, message: "Payment submitted. The founder will review it shortly." };
}
