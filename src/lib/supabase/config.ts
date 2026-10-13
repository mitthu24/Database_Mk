// Single source of truth for "which Supabase project is this deployment allowed
// to talk to?". It fails CLOSED so a Vercel deployment cannot silently use the
// wrong database:
//
//  * VERCEL_ENV=production  -> PRODUCTION_SUPABASE_PROJECT_REF must be set (an
//    explicit confirmation that the production project was verified) and the
//    configured URL must be exactly that project over https.
//  * VERCEL_ENV=preview/development or any non-Vercel host -> if
//    PRODUCTION_SUPABASE_PROJECT_REF is set and the URL points at it, the
//    configuration is rejected: previews and local runs must never touch the
//    production database.
//
// Set PRODUCTION_SUPABASE_PROJECT_REF in EVERY Vercel environment (Production,
// Preview, Development); only the Supabase URL/keys differ per environment.

export type EnvLike = Record<string, string | undefined>;

export type AppEnvironment = "production" | "preview" | "development";

export type SupabaseConfig =
  | { ok: true; url: string; anonKey: string; environment: AppEnvironment }
  | { ok: false; reason: string; environment: AppEnvironment };

const HOSTED_HOST = /^([a-z0-9]{20})\.supabase\.co$/;

export function appEnvironment(env: EnvLike): AppEnvironment {
  const v = env.VERCEL_ENV;
  return v === "production" || v === "preview" ? v : "development";
}

export function evaluateSupabaseConfig(env: EnvLike): SupabaseConfig {
  const environment = appEnvironment(env);
  const fail = (reason: string): SupabaseConfig => ({ ok: false, reason, environment });

  const rawUrl = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!rawUrl || !anonKey) {
    return fail("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are not both set.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return fail("NEXT_PUBLIC_SUPABASE_URL is not a valid URL.");
  }

  const ref = HOSTED_HOST.exec(parsed.hostname)?.[1] ?? null;
  const productionRef = env.PRODUCTION_SUPABASE_PROJECT_REF?.trim() || null;

  if (environment === "production") {
    if (!productionRef) {
      return fail(
        "PRODUCTION_SUPABASE_PROJECT_REF is not set. Production stays disabled until the verified production project is confirmed explicitly.",
      );
    }
    if (parsed.protocol !== "https:" || ref !== productionRef) {
      return fail("NEXT_PUBLIC_SUPABASE_URL does not point at the confirmed production Supabase project.");
    }
  } else if (productionRef && ref === productionRef) {
    return fail("This non-production environment is configured with the PRODUCTION Supabase project. Use a development project.");
  }

  return { ok: true, url: parsed.origin, anonKey, environment };
}

export function getSupabaseConfig(): SupabaseConfig {
  return evaluateSupabaseConfig(process.env);
}

export function requireSupabaseConfig(): { url: string; anonKey: string } {
  const config = getSupabaseConfig();
  if (!config.ok) throw new Error(`Supabase configuration rejected: ${config.reason}`);
  return { url: config.url, anonKey: config.anonKey };
}

// Base URL used in email confirmation / invite links. Production must set it
// explicitly (never silently fall back to localhost).
export function resolveSiteUrl(env: EnvLike): string {
  const configured = env.NEXT_PUBLIC_SITE_URL?.trim();
  const environment = appEnvironment(env);

  if (environment === "production") {
    if (!configured || !configured.startsWith("https://")) {
      throw new Error("NEXT_PUBLIC_SITE_URL must be set to an https:// URL in production.");
    }
    return configured.replace(/\/+$/, "");
  }
  if (configured) return configured.replace(/\/+$/, "");
  if (environment === "preview" && env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export function getSiteUrl(): string {
  return resolveSiteUrl(process.env);
}
