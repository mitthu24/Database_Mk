import { beforeEach, describe, expect, it, vi } from "vitest";

const requireCompanyAdmin = vi.fn();
const createAdminClient = vi.fn();

vi.mock("@/lib/auth/dal", () => ({ requireCompanyAdmin: () => requireCompanyAdmin() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => createAdminClient() }));

import { provisionEmployee } from "@/lib/admin/provision-employee";

const adminCtx = {
  userId: "admin-user-id",
  companyId: "company-A",
  role: "admin" as const,
  access: "full" as const,
};

function fakeService(opts: { inviteError?: boolean; memberError?: { code: string } } = {}) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = [];
  const service = {
    auth: {
      admin: {
        inviteUserByEmail: vi.fn(async () =>
          opts.inviteError
            ? { data: { user: null }, error: { message: "exists" } }
            : { data: { user: { id: "new-user-id" } }, error: null },
        ),
        deleteUser: vi.fn(async () => ({ error: null })),
      },
    },
    from: vi.fn((table: string) => ({
      insert: vi.fn(async (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        return { error: table === "company_members" ? (opts.memberError ?? null) : null };
      }),
    })),
  };
  return { service, inserts };
}

beforeEach(() => {
  requireCompanyAdmin.mockReset();
  createAdminClient.mockReset();
  requireCompanyAdmin.mockResolvedValue(adminCtx);
});

describe("provisionEmployee", () => {
  it("takes company id and role from the verified admin, never from the request", async () => {
    const { service, inserts } = fakeService();
    createAdminClient.mockReturnValue(service);

    const result = await provisionEmployee({
      email: "New.Employee@Example.com",
      fullName: "New Employee",
      employeeCode: "EMP-010",
      // hostile extras
      company_id: "company-B",
      companyId: "company-B",
      role: "admin",
    });

    expect(result.ok).toBe(true);
    const member = inserts.find((i) => i.table === "company_members")!.row;
    expect(member).toMatchObject({
      company_id: "company-A",
      user_id: "new-user-id",
      role: "employee",
      status: "active",
      employee_code: "EMP-010",
      created_by: "admin-user-id",
    });
    expect(service.auth.admin.inviteUserByEmail).toHaveBeenCalledWith(
      "new.employee@example.com",
      expect.objectContaining({ data: { full_name: "New Employee" } }),
    );
  });

  it("writes an audit event scoped to the admin's company", async () => {
    const { service, inserts } = fakeService();
    createAdminClient.mockReturnValue(service);
    await provisionEmployee({ email: "e@example.com", fullName: "Emp Loyee" });
    const audit = inserts.find((i) => i.table === "audit_logs")!.row;
    expect(audit).toMatchObject({
      company_id: "company-A",
      actor_id: "admin-user-id",
      action: "employee.provisioned",
      target_id: "new-user-id",
    });
  });

  it("does nothing when the caller is not an authorized admin (DAL redirects/throws)", async () => {
    requireCompanyAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(provisionEmployee({ email: "e@example.com", fullName: "Emp Loyee" })).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each(["read_only", "suspended", "disabled"] as const)(
    "refuses to provision when company access is %s",
    async (access) => {
      requireCompanyAdmin.mockResolvedValue({ ...adminCtx, access });
      const result = await provisionEmployee({ email: "e@example.com", fullName: "Emp Loyee" });
      expect(result.ok).toBeUndefined();
      expect(result.message).toBeTruthy();
      expect(createAdminClient).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid input before touching the service client", async () => {
    const result = await provisionEmployee({ email: "not-an-email", fullName: "x" });
    expect(result.fieldErrors?.email).toBeTruthy();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("does not insert a membership when the invite fails (e.g. email already has an account)", async () => {
    const { service, inserts } = fakeService({ inviteError: true });
    createAdminClient.mockReturnValue(service);
    const result = await provisionEmployee({ email: "taken@example.com", fullName: "Taken User" });
    expect(result.ok).toBeUndefined();
    expect(inserts).toHaveLength(0);
    expect(service.auth.admin.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes the freshly created auth user if attaching the membership fails", async () => {
    const { service, inserts } = fakeService({ memberError: { code: "23505" } });
    createAdminClient.mockReturnValue(service);
    const result = await provisionEmployee({
      email: "e@example.com",
      fullName: "Emp Loyee",
      employeeCode: "DUP",
    });
    expect(result.message).toMatch(/employee code is already used/);
    expect(service.auth.admin.deleteUser).toHaveBeenCalledWith("new-user-id");
    expect(inserts.some((i) => i.table === "audit_logs")).toBe(false);
  });
});
