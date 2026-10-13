import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackendError } from "@/lib/backend/port";

const requireUser = vi.fn();
const requireCompanyAdmin = vi.fn();
const getBackend = vi.fn();

vi.mock("@/lib/auth/dal", () => ({
  requireUser: () => requireUser(),
  requireCompanyAdmin: () => requireCompanyAdmin(),
}));
vi.mock("@/lib/backend", () => ({ getBackend: () => getBackend() }));

import { updateCompanyProfile, updateMyProfile } from "@/lib/company/actions";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  requireUser.mockReset();
  requireCompanyAdmin.mockReset();
  getBackend.mockReset();
});

describe("updateMyProfile", () => {
  it("validates and calls the backend", async () => {
    const updateMyProfileFn = vi.fn();
    getBackend.mockResolvedValue({ data: { updateMyProfile: updateMyProfileFn } });
    const result = await updateMyProfile(undefined, form({ fullName: "  Alice  " }));
    expect(result.ok).toBe(true);
    expect(updateMyProfileFn).toHaveBeenCalledWith("Alice");
  });
  it("rejects a too-short name without touching the backend", async () => {
    const result = await updateMyProfile(undefined, form({ fullName: "A" }));
    expect(result.fieldErrors?.fullName).toBeTruthy();
    expect(getBackend).not.toHaveBeenCalled();
  });
});

describe("updateCompanyProfile", () => {
  beforeEach(() => requireCompanyAdmin.mockResolvedValue({ companyId: "c1", role: "admin" }));

  it("validates and calls the backend", async () => {
    const updateCompanyProfileFn = vi.fn();
    getBackend.mockResolvedValue({ data: { updateCompanyProfile: updateCompanyProfileFn } });
    const result = await updateCompanyProfile(undefined, form({ name: "Acme Plywood", contactEmail: "a@b.test", phone: "", address: "" }));
    expect(result.ok).toBe(true);
    expect(updateCompanyProfileFn).toHaveBeenCalledWith({ name: "Acme Plywood", contactEmail: "a@b.test", phone: "", address: "" });
  });
  it("reports a forbidden write (read-only/suspended) in plain language", async () => {
    getBackend.mockResolvedValue({ data: { updateCompanyProfile: vi.fn().mockRejectedValue(new BackendError("forbidden", "x")) } });
    const result = await updateCompanyProfile(undefined, form({ name: "Acme", contactEmail: "" }));
    expect(result.message).toMatch(/read-only or suspended/);
  });
  it("rejects invalid input before touching the backend", async () => {
    const result = await updateCompanyProfile(undefined, form({ name: "A", contactEmail: "" }));
    expect(result.fieldErrors?.name).toBeTruthy();
    expect(getBackend).not.toHaveBeenCalled();
  });
});
