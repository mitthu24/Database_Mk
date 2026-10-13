import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackendError } from "@/lib/backend/port";

const requireCompanyAdmin = vi.fn();
const getBackend = vi.fn();

vi.mock("@/lib/auth/dal", () => ({ requireCompanyAdmin: () => requireCompanyAdmin() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => getBackend() }));

import { provisionEmployee } from "@/lib/admin/provision-employee";

const adminCtx = {
  userId: "admin-user-id",
  companyId: "company-A",
  role: "admin" as const,
  access: "full" as const,
};

function fakeBackend(opts: { inviteError?: boolean; memberError?: BackendError } = {}) {
  const inviteUser = vi.fn(async () =>
    opts.inviteError ? { ok: false as const, code: "unknown" as const } : { ok: true as const, userId: "new-user-id" },
  );
  const deleteUser = vi.fn(async () => undefined);
  const addMember = vi.fn(async (userId: string, code?: string) => {
    if (opts.memberError) throw opts.memberError;
    return { id: "m1", userId, role: "employee", status: "active", employeeCode: code ?? null, createdAt: "now", email: null, fullName: null, tablesWithAccess: 0 };
  });
  return { authAdmin: { inviteUser, deleteUser }, data: { addMember } };
}

beforeEach(() => {
  requireCompanyAdmin.mockReset();
  getBackend.mockReset();
  requireCompanyAdmin.mockResolvedValue(adminCtx);
});

describe("provisionEmployee", () => {
  it("takes the company and role from the verified admin, never from the request", async () => {
    const backend = fakeBackend();
    getBackend.mockResolvedValue(backend);

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
    expect(backend.authAdmin.inviteUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new.employee@example.com", fullName: "New Employee" }),
    );
    expect(backend.data.addMember).toHaveBeenCalledWith("new-user-id", "EMP-010");
  });

  it("does nothing when the caller is not an authorized admin (DAL redirects/throws)", async () => {
    requireCompanyAdmin.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(provisionEmployee({ email: "e@example.com", fullName: "Emp Loyee" })).rejects.toThrow("NEXT_REDIRECT");
    expect(getBackend).not.toHaveBeenCalled();
  });

  it.each(["read_only", "suspended", "disabled"] as const)(
    "refuses to provision when company access is %s",
    async (access) => {
      requireCompanyAdmin.mockResolvedValue({ ...adminCtx, access });
      const result = await provisionEmployee({ email: "e@example.com", fullName: "Emp Loyee" });
      expect(result.ok).toBeUndefined();
      expect(result.message).toBeTruthy();
      expect(getBackend).not.toHaveBeenCalled();
    },
  );

  it("rejects invalid input before touching the backend", async () => {
    const result = await provisionEmployee({ email: "not-an-email", fullName: "x" });
    expect(result.fieldErrors?.email).toBeTruthy();
    expect(getBackend).not.toHaveBeenCalled();
  });

  it("does not add a membership when the invite fails (e.g. email already has an account)", async () => {
    const backend = fakeBackend({ inviteError: true });
    getBackend.mockResolvedValue(backend);
    const result = await provisionEmployee({ email: "taken@example.com", fullName: "Taken User" });
    expect(result.ok).toBeUndefined();
    expect(backend.data.addMember).not.toHaveBeenCalled();
    expect(backend.authAdmin.deleteUser).not.toHaveBeenCalled();
  });

  it("deletes the freshly created auth user if attaching the membership fails", async () => {
    const backend = fakeBackend({ memberError: new BackendError("conflict", "That employee code is already used in your company.") });
    getBackend.mockResolvedValue(backend);
    const result = await provisionEmployee({ email: "e@example.com", fullName: "Emp Loyee", employeeCode: "DUP" });
    expect(result.message).toMatch(/employee code is already used/);
    expect(backend.authAdmin.deleteUser).toHaveBeenCalledWith("new-user-id");
  });
});
