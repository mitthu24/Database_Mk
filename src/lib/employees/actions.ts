"use server";

import { provisionEmployee } from "@/lib/admin/provision-employee";
import { requireCompanyAdmin } from "@/lib/auth/dal";
import type { ActionState } from "@/lib/auth/validation";
import { getBackend } from "@/lib/backend";
import { BackendError } from "@/lib/backend/port";
import type { PermissionFlags } from "@/lib/backend/types";

const GENERIC_ERROR = "Something went wrong. Please try again.";

function toMessage(error: unknown): string {
  return error instanceof BackendError ? error.message : GENERIC_ERROR;
}

export async function addEmployee(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  return provisionEmployee({
    email: formData.get("email"),
    fullName: formData.get("fullName"),
    employeeCode: formData.get("employeeCode") || undefined,
  });
}

export async function setMemberStatus(memberId: string, status: "active" | "disabled") {
  await requireCompanyAdmin();
  try {
    const backend = await getBackend();
    await backend.data.setMemberStatus(memberId, status);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: toMessage(error) };
  }
}

export async function setMemberRole(memberId: string, role: "admin" | "employee") {
  await requireCompanyAdmin();
  try {
    const backend = await getBackend();
    await backend.data.setMemberRole(memberId, role);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: toMessage(error) };
  }
}

export async function setMemberCode(memberId: string, code: string) {
  await requireCompanyAdmin();
  const trimmed = code.trim();
  if (trimmed && !/^[A-Za-z0-9._-]{1,32}$/.test(trimmed)) {
    return { ok: false as const, message: "Use 1-32 letters, digits, dot, underscore or dash." };
  }
  try {
    const backend = await getBackend();
    await backend.data.setMemberCode(memberId, trimmed);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: toMessage(error) };
  }
}

export async function listPermissionsFor(userId: string) {
  await requireCompanyAdmin();
  const backend = await getBackend();
  return backend.data.listPermissions(userId);
}

export async function setTablePermission(userId: string, tableId: string, flags: PermissionFlags) {
  await requireCompanyAdmin();
  try {
    const backend = await getBackend();
    await backend.data.setTablePermission(userId, tableId, flags);
    return { ok: true as const };
  } catch (error) {
    return { ok: false as const, message: toMessage(error) };
  }
}
