import { evaluateSupabaseConfig, type EnvLike } from "@/lib/supabase/config";

// Which backend serves this deployment. Pure (no server-only imports) so the
// proxy and server code share one decision.
//   * default          -> Supabase (config validated; fails closed)
//   * APP_BACKEND=mock -> in-memory DEV/TEST backend, never on Vercel production
//     and never an automatic fallback.

export type BackendMode =
  | { mode: "supabase" }
  | { mode: "mock" }
  | { mode: "unconfigured"; reason: string }
  | { mode: "refused"; reason: string };

export function resolveBackendMode(env: EnvLike = process.env): BackendMode {
  if (env.APP_BACKEND === "mock") {
    if (env.VERCEL_ENV === "production") {
      return { mode: "refused", reason: "APP_BACKEND=mock is a development/test setting and is refused on production deployments." };
    }
    return { mode: "mock" };
  }
  const config = evaluateSupabaseConfig(env);
  return config.ok ? { mode: "supabase" } : { mode: "unconfigured", reason: config.reason };
}
