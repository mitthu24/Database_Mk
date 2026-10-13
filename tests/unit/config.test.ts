import { describe, expect, it } from "vitest";

import { appEnvironment, evaluateSupabaseConfig, resolveSiteUrl } from "@/lib/supabase/config";

const PROD_REF = "abcdefghij0123456789";
const DEV_REF = "zyxwvutsrq9876543210";
const anon = "placeholder-anon-key";
const urlFor = (ref: string) => `https://${ref}.supabase.co`;

describe("evaluateSupabaseConfig — production", () => {
  const prod = { VERCEL_ENV: "production", NEXT_PUBLIC_SUPABASE_ANON_KEY: anon };

  it("accepts the confirmed production project over https", () => {
    const r = evaluateSupabaseConfig({
      ...prod,
      NEXT_PUBLIC_SUPABASE_URL: urlFor(PROD_REF),
      PRODUCTION_SUPABASE_PROJECT_REF: PROD_REF,
    });
    expect(r.ok).toBe(true);
  });

  it("refuses to run until the production ref is explicitly confirmed", () => {
    const r = evaluateSupabaseConfig({ ...prod, NEXT_PUBLIC_SUPABASE_URL: urlFor(PROD_REF) });
    expect(r.ok).toBe(false);
  });

  it("refuses a development project URL in production", () => {
    const r = evaluateSupabaseConfig({
      ...prod,
      NEXT_PUBLIC_SUPABASE_URL: urlFor(DEV_REF),
      PRODUCTION_SUPABASE_PROJECT_REF: PROD_REF,
    });
    expect(r.ok).toBe(false);
  });

  it.each(["http://127.0.0.1:54321", `http://${PROD_REF}.supabase.co`, "https://evil.example.com"])(
    "refuses %s in production",
    (url) => {
      const r = evaluateSupabaseConfig({
        ...prod,
        NEXT_PUBLIC_SUPABASE_URL: url,
        PRODUCTION_SUPABASE_PROJECT_REF: PROD_REF,
      });
      expect(r.ok).toBe(false);
    },
  );

  it("refuses a lookalike host that merely contains the ref", () => {
    const r = evaluateSupabaseConfig({
      ...prod,
      NEXT_PUBLIC_SUPABASE_URL: `https://${PROD_REF}.supabase.co.evil.example`,
      PRODUCTION_SUPABASE_PROJECT_REF: PROD_REF,
    });
    expect(r.ok).toBe(false);
  });
});

describe("evaluateSupabaseConfig — preview, development and other hosts", () => {
  it.each(["preview", "development", undefined])(
    "rejects the PRODUCTION project when VERCEL_ENV=%s",
    (VERCEL_ENV) => {
      const r = evaluateSupabaseConfig({
        VERCEL_ENV,
        NEXT_PUBLIC_SUPABASE_URL: urlFor(PROD_REF),
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
        PRODUCTION_SUPABASE_PROJECT_REF: PROD_REF,
      });
      expect(r.ok).toBe(false);
    },
  );

  it("accepts a development project and local Supabase", () => {
    for (const url of [urlFor(DEV_REF), "http://127.0.0.1:54321"]) {
      const r = evaluateSupabaseConfig({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
        PRODUCTION_SUPABASE_PROJECT_REF: PROD_REF,
      });
      expect(r.ok).toBe(true);
    }
  });

  it("fails when URL or anon key is missing or malformed", () => {
    expect(evaluateSupabaseConfig({}).ok).toBe(false);
    expect(evaluateSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: urlFor(DEV_REF) }).ok).toBe(false);
    expect(
      evaluateSupabaseConfig({ NEXT_PUBLIC_SUPABASE_URL: "not a url", NEXT_PUBLIC_SUPABASE_ANON_KEY: anon }).ok,
    ).toBe(false);
  });

  it("never echoes keys or refs in the rejection reason", () => {
    const r = evaluateSupabaseConfig({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: urlFor(PROD_REF),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: anon,
      PRODUCTION_SUPABASE_PROJECT_REF: PROD_REF,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).not.toContain(PROD_REF);
      expect(r.reason).not.toContain(anon);
    }
  });
});

describe("appEnvironment / resolveSiteUrl", () => {
  it("maps VERCEL_ENV and defaults to development", () => {
    expect(appEnvironment({ VERCEL_ENV: "production" })).toBe("production");
    expect(appEnvironment({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(appEnvironment({ NODE_ENV: "production" })).toBe("development");
    expect(appEnvironment({})).toBe("development");
  });

  it("requires an explicit https site URL in production (no localhost fallback)", () => {
    expect(() => resolveSiteUrl({ VERCEL_ENV: "production" })).toThrow();
    expect(() => resolveSiteUrl({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "http://localhost:3000" })).toThrow();
    expect(resolveSiteUrl({ VERCEL_ENV: "production", NEXT_PUBLIC_SITE_URL: "https://app.example.com/" })).toBe(
      "https://app.example.com",
    );
  });

  it("falls back sensibly outside production", () => {
    expect(resolveSiteUrl({})).toBe("http://localhost:3000");
    expect(resolveSiteUrl({ VERCEL_ENV: "preview", VERCEL_URL: "x-git-branch.vercel.app" })).toBe(
      "https://x-git-branch.vercel.app",
    );
  });
});
