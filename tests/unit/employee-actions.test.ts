import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackendError } from "@/lib/backend/port";

const requireCompanyAdmin = vi.fn();
const getBackend = vi.fn();

vi.mock("@/lib/auth/dal", () => ({ requireCompanyAdmin: () => requireCompanyAdmin() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => getBackend() }));

import { listPermissionsFor, setMemberCode, setMemberRole, setMemberStatus, setTablePermission } from "@/lib/employees/actions";

beforeEach(() => {
  requireCompanyAdmin.mockReset();
  getBackend.mockReset();
  requireCompanyAdmin.mockResolvedValue({ companyId: "c1", role: "admin" });
});

describe("setMemberStatus / setMemberRole", () => {
  it("calls the backend and maps errors", async () => {
    const setMemberStatusFn = vi.fn();
    getBackend.mockResolvedValue({ data: { setMemberStatus: setMemberStatusFn } });
    expect(await setMemberStatus("m1", "disabled")).toEqual({ ok: true });
    expect(setMemberStatusFn).toHaveBeenCalledWith("m1", "disabled");
  });
  it("surfaces a self-change rejection", async () => {
    getBackend.mockResolvedValue({ data: { setMemberRole: vi.fn().mockRejectedValue(new BackendError("invalid", "you cannot change your own role")) } });
    expect(await setMemberRole("m1", "employee")).toEqual({ ok: false, message: "you cannot change your own role" });
  });
});

describe("setMemberCode", () => {
  it("rejects a malformed code without calling the backend", async () => {
    const result = await setMemberCode("m1", "bad code!");
    expect(result.ok).toBe(false);
    expect(getBackend).not.toHaveBeenCalled();
  });
  it("accepts an empty code (clears it) and a valid one", async () => {
    const setMemberCodeFn = vi.fn();
    getBackend.mockResolvedValue({ data: { setMemberCode: setMemberCodeFn } });
    await setMemberCode("m1", "  ");
    expect(setMemberCodeFn).toHaveBeenCalledWith("m1", "");
    await setMemberCode("m1", "EMP-0099");
    expect(setMemberCodeFn).toHaveBeenCalledWith("m1", "EMP-0099");
  });
});

describe("permissions", () => {
  it("lists and sets table permissions", async () => {
    const listPermissions = vi.fn().mockResolvedValue([{ tableId: "t1" }]);
    const setTablePermissionFn = vi.fn();
    getBackend.mockResolvedValue({ data: { listPermissions, setTablePermission: setTablePermissionFn } });

    expect(await listPermissionsFor("u1")).toEqual([{ tableId: "t1" }]);
    expect(listPermissions).toHaveBeenCalledWith("u1");

    const flags = { view: true, create: false, edit: false, delete: false, import: false, export: false };
    expect(await setTablePermission("u1", "t1", flags)).toEqual({ ok: true });
    expect(setTablePermissionFn).toHaveBeenCalledWith("u1", "t1", flags);
  });
});
