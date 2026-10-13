import "server-only";

import { requireCompanyAdmin } from "@/lib/auth/dal";
import { employeeSchema, fieldErrorsFrom, type ActionState } from "@/lib/auth/validation";
import { getBackend } from "@/lib/backend";
import { BackendError } from "@/lib/backend/port";
import { getSiteUrl } from "@/lib/supabase/config";

// Creates an employee in the CALLER's company. Design rules:
//  1. Authorization first: the caller must be an active admin of a company that
//     is allowed to write (not suspended, not read-only). This comes from the
//     database via the DAL, never from the request.
//  2. The company id and role are never taken from the request: addMember()
//     resolves them server-side from the admin's own verified session/RLS, and
//     any company_id / role field sent by the browser is ignored (the schema
//     does not even parse them).
//  3. Existing accounts are never touched: the invite fails for an email that
//     already has an account, so one company cannot capture another's user.
//  4. The employee sets their own password through the invite link; admins
//     never see or choose it.
//  5. If attaching the membership fails, the freshly created auth user is
//     deleted so no orphan identity is left behind.
//  6. inviteUser lives behind AuthAdminPort (service-role / mock only, never
//     reachable from the browser); add_company_member runs as the admin's own
//     verified identity, so it re-checks admin status and entitlement itself.
export async function provisionEmployee(input: unknown): Promise<ActionState> {
  const admin = await requireCompanyAdmin();

  if (admin.access !== "full") {
    return { message: "Your company is currently read-only. Employees cannot be added." };
  }

  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) return { fieldErrors: fieldErrorsFrom(parsed.error) };
  const { email, fullName, employeeCode } = parsed.data;

  const backend = await getBackend();
  const invited = await backend.authAdmin.inviteUser({
    email,
    fullName,
    redirectTo: `${getSiteUrl()}/auth/callback?next=/account/password`,
  });
  if (!invited.ok) {
    return { message: "Could not invite that email address. It may already have an account." };
  }

  try {
    await backend.data.addMember(invited.userId, employeeCode);
  } catch (error) {
    await backend.authAdmin.deleteUser(invited.userId);
    if (error instanceof BackendError && error.kind === "conflict") {
      return { message: error.message };
    }
    return { message: "Could not add the employee. Please try again." };
  }

  return { ok: true, message: "Invitation sent." };
}
