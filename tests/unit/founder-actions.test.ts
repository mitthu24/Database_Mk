import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackendError } from "@/lib/backend/port";

const requireFounder = vi.fn();
const getBackend = vi.fn();

vi.mock("@/lib/auth/dal", () => ({ requireFounder: () => requireFounder() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => getBackend() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { createCompany, reviewPayment, setCompanyStatus, setSubscription, updatePlatformSetting } from "@/lib/founder/actions";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  requireFounder.mockReset();
  getBackend.mockReset();
  requireFounder.mockResolvedValue({ userId: "founder-1", isFounder: true });
});

describe("setCompanyStatus", () => {
  it("suspends and maps errors", async () => {
    const fn = vi.fn();
    getBackend.mockResolvedValue({ data: { founderSetCompanyStatus: fn } });
    expect(await setCompanyStatus("c1", "suspended", "fraud")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("c1", "suspended", "fraud");
  });
  it("maps a backend error", async () => {
    getBackend.mockResolvedValue({ data: { founderSetCompanyStatus: vi.fn().mockRejectedValue(new BackendError("not_found", "gone")) } });
    expect(await setCompanyStatus("c1", "active")).toEqual({ ok: false, message: "gone" });
  });
});

describe("setSubscription", () => {
  it("calls the backend with the chosen status and trial date", async () => {
    const fn = vi.fn();
    getBackend.mockResolvedValue({ data: { founderSetSubscription: fn } });
    await setSubscription("c1", "trialing", "2026-12-01T00:00:00.000Z");
    expect(fn).toHaveBeenCalledWith("c1", { status: "trialing", trialEndsAt: "2026-12-01T00:00:00.000Z" });
  });
});

describe("reviewPayment", () => {
  it("requires a reason to reject", async () => {
    const result = await reviewPayment("p1", "reject");
    expect(result).toEqual({ ok: false, message: "A reason is required to reject a payment." });
    expect(getBackend).not.toHaveBeenCalled();
  });
  it("approves and reports success", async () => {
    getBackend.mockResolvedValue({ data: { founderReviewPayment: vi.fn().mockResolvedValue({ companyId: "c1" }) } });
    expect(await reviewPayment("p1", "approve")).toEqual({ ok: true });
  });
});

describe("createCompany", () => {
  it("validates input before inviting anyone", async () => {
    const result = await createCompany(undefined, form({ companyName: "A", email: "not-an-email", fullName: "X" }));
    expect(result.fieldErrors).toBeTruthy();
    expect(getBackend).not.toHaveBeenCalled();
  });

  it("invites the admin, creates the company, and returns its id", async () => {
    const inviteUser = vi.fn().mockResolvedValue({ ok: true, userId: "u1" });
    const founderCreateCompany = vi.fn().mockResolvedValue("company-1");
    getBackend.mockResolvedValue({ authAdmin: { inviteUser, deleteUser: vi.fn() }, data: { founderCreateCompany } });

    const result = await createCompany(undefined, form({ companyName: "Acme Plywood", email: "admin@acme.test", fullName: "Admin Person" }));
    expect(result).toMatchObject({ ok: true, companyId: "company-1" });
    expect(founderCreateCompany).toHaveBeenCalledWith("u1", "Acme Plywood");
  });

  it("deletes the invited user if company creation fails", async () => {
    const deleteUser = vi.fn();
    getBackend.mockResolvedValue({
      authAdmin: { inviteUser: vi.fn().mockResolvedValue({ ok: true, userId: "u1" }), deleteUser },
      data: { founderCreateCompany: vi.fn().mockRejectedValue(new BackendError("conflict", "That already exists.")) },
    });
    const result = await createCompany(undefined, form({ companyName: "Dup Co", email: "a@b.test", fullName: "A B" }));
    expect(result.fieldErrors?.companyName).toBeTruthy();
    expect(deleteUser).toHaveBeenCalledWith("u1");
  });
});

describe("updatePlatformSetting", () => {
  it("calls the backend", async () => {
    const fn = vi.fn();
    getBackend.mockResolvedValue({ data: { founderUpdateSetting: fn } });
    expect(await updatePlatformSetting("support_email", "help@acme.test")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("support_email", "help@acme.test");
  });
});
