"use server";

import { requireCompanyAdmin, requireUser } from "@/lib/auth/dal";
import { companyProfileSchema, fieldErrorsFrom, profileNameSchema, type ActionState } from "@/lib/auth/validation";
import { getBackend } from "@/lib/backend";
import { BackendError } from "@/lib/backend/port";

const GENERIC_ERROR = "Something went wrong. Please try again.";

export async function updateMyProfile(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  await requireUser();
  const parsed = profileNameSchema.safeParse({ fullName: formData.get("fullName") });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    const backend = await getBackend();
    await backend.data.updateMyProfile(parsed.data.fullName);
  } catch (error) {
    return { message: error instanceof BackendError ? error.message : GENERIC_ERROR };
  }
  return { ok: true, message: "Your name was updated." };
}

export async function updateCompanyProfile(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  // Writes are only meaningful for an active admin; a read-only/suspended
  // company's admin still passes requireCompanyAdmin (role check only) but the
  // RPC/mock itself refuses the write, so the message below reflects that.
  await requireCompanyAdmin();

  const parsed = companyProfileSchema.safeParse({
    name: formData.get("name"),
    contactEmail: formData.get("contactEmail"),
    phone: formData.get("phone"),
    address: formData.get("address"),
  });
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };

  try {
    const backend = await getBackend();
    await backend.data.updateCompanyProfile(parsed.data);
  } catch (error) {
    if (error instanceof BackendError) {
      if (error.kind === "forbidden") return { message: "Your company cannot be edited right now (it is read-only or suspended)." };
      if (error.kind === "invalid") return { fieldErrors: { name: [error.message] } };
      return { message: error.message };
    }
    return { message: GENERIC_ERROR };
  }
  return { ok: true, message: "Company profile updated." };
}
