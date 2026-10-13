import "server-only";

import { requireCompanyAdmin } from "@/lib/auth/dal";
import { employeeSchema, fieldErrorsFrom, type ActionState } from "@/lib/auth/validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSiteUrl } from "@/lib/supabase/config";

// Creates an employee in the CALLER's company. Design rules:
//  1. Authorization first: the caller must be an active admin of a company that
//     is allowed to write (not suspended, not read-only). This comes from the
//     database via the DAL, never from the request.
//  2. The company id and role are taken from that verified context. Any
//     company_id / role field sent by the browser is ignored (the schema does
//     not even parse them).
//  3. Existing accounts are never touched: the invite fails for an email that
//     already has an account, so one company cannot capture another's user.
//  4. The employee sets their own password through the invite link; admins
//     never see or choose it.
//  5. If attaching the membership fails, the freshly created auth user is
//     deleted so no orphan identity is left behind.
//  6. The service-role key stays inside createAdminClient (server-only).
export async function provisionEmployee(input: unknown): Promise<ActionState> {
  const admin = await requireCompanyAdmin();

  if (admin.access !== "full") {
    return { message: "Your company is currently read-only. Employees cannot be added." };
  }

  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const { email, fullName, employeeCode } = parsed.data;

  const service = createAdminClient();
  const siteUrl = getSiteUrl();

  const { data: invited, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName },
    redirectTo: `${siteUrl}/auth/callback?next=/account/password`,
  });
  if (inviteError || !invited.user) {
    return { message: "Could not invite that email address. It may already have an account." };
  }

  const { error: memberError } = await service.from("company_members").insert({
    company_id: admin.companyId,
    user_id: invited.user.id,
    role: "employee",
    status: "active",
    employee_code: employeeCode ?? null,
    created_by: admin.userId,
  });

  if (memberError) {
    await service.auth.admin.deleteUser(invited.user.id);
    return {
      message:
        memberError.code === "23505"
          ? "That employee code is already used in your company."
          : "Could not add the employee. Please try again.",
    };
  }

  await service.from("audit_logs").insert({
    company_id: admin.companyId,
    actor_id: admin.userId,
    action: "employee.provisioned",
    target_type: "user",
    target_id: invited.user.id,
    metadata: { employee_code: employeeCode ?? null },
  });

  return { ok: true, message: "Invitation sent." };
}
