import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("POST /api/dev-reset-mock", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.APP_BACKEND;
    delete process.env.VERCEL_ENV;
  });

  it("404s when the backend is not the mock backend", async () => {
    delete process.env.APP_BACKEND;
    const { POST } = await import("@/app/api/dev-reset-mock/route");
    const res = await POST();
    expect(res.status).toBe(404);
  });

  it("resets the store and succeeds when APP_BACKEND=mock", async () => {
    process.env.APP_BACKEND = "mock";
    const { POST } = await import("@/app/api/dev-reset-mock/route");
    const { getMockStore } = await import("@/lib/backend/mock/store");
    const store = getMockStore();
    store.companies.set("extra", { id: "extra", name: "Extra", status: "active", contactEmail: null, phone: null, address: null, createdAt: new Date() });

    const res = await POST();
    expect(res.status).toBe(200);
    expect(getMockStore().companies.has("extra")).toBe(false); // reset wiped it
  });

  it("is refused on a Vercel production deployment even with APP_BACKEND=mock", async () => {
    process.env.APP_BACKEND = "mock";
    process.env.VERCEL_ENV = "production";
    const { POST } = await import("@/app/api/dev-reset-mock/route");
    const res = await POST();
    expect(res.status).toBe(404);
  });
});
