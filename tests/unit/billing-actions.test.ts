import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackendError } from "@/lib/backend/port";

const requireCompanyAdmin = vi.fn();
const getBackend = vi.fn();

vi.mock("@/lib/auth/dal", () => ({ requireCompanyAdmin: () => requireCompanyAdmin() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => getBackend() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { submitPayment } from "@/lib/billing/actions";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const valid = { amount: "49.00", currency: "usd", months: "1", method: "Bank transfer", reference: "REF-123", note: "" };

beforeEach(() => {
  requireCompanyAdmin.mockReset();
  getBackend.mockReset();
  requireCompanyAdmin.mockResolvedValue({ companyId: "c1", role: "admin" });
});

describe("submitPayment", () => {
  it("normalises the currency and calls the backend", async () => {
    const submitPaymentFn = vi.fn();
    getBackend.mockResolvedValue({ data: { submitPayment: submitPaymentFn } });
    const result = await submitPayment(undefined, form(valid));
    expect(result.ok).toBe(true);
    expect(submitPaymentFn).toHaveBeenCalledWith({ amount: 49, currency: "USD", months: 1, method: "Bank transfer", reference: "REF-123", note: "" });
  });

  it("rejects an invalid amount before touching the backend", async () => {
    const result = await submitPayment(undefined, form({ ...valid, amount: "0" }));
    expect(result.fieldErrors?.amount).toBeTruthy();
    expect(getBackend).not.toHaveBeenCalled();
  });

  it("rejects a short reference", async () => {
    const result = await submitPayment(undefined, form({ ...valid, reference: "ab" }));
    expect(result.fieldErrors?.reference).toBeTruthy();
  });

  it("surfaces a suspended-company rejection in plain language", async () => {
    getBackend.mockResolvedValue({ data: { submitPayment: vi.fn().mockRejectedValue(new BackendError("forbidden", "x")) } });
    const result = await submitPayment(undefined, form(valid));
    expect(result.message).toMatch(/cannot submit a payment/);
  });

  it("surfaces a duplicate reference on the reference field", async () => {
    getBackend.mockResolvedValue({
      data: { submitPayment: vi.fn().mockRejectedValue(new BackendError("conflict", "That payment reference was already submitted.")) },
    });
    const result = await submitPayment(undefined, form(valid));
    expect(result.fieldErrors?.reference?.[0]).toMatch(/already submitted/);
  });

  it("surfaces a pending-limit rejection", async () => {
    getBackend.mockResolvedValue({
      data: { submitPayment: vi.fn().mockRejectedValue(new BackendError("limit", "too many pending payments; wait for review")) },
    });
    const result = await submitPayment(undefined, form(valid));
    expect(result.message).toMatch(/too many pending/);
  });
});
