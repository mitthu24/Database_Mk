import "server-only";

import { cookies } from "next/headers";

import { BackendError, type Backend } from "@/lib/backend/port";
import { createSupabaseBackend } from "@/lib/backend/supabase-adapter";
import { createMockBackend } from "@/lib/backend/mock";
import { MOCK_COOKIE } from "@/lib/backend/mock/store";
import { getSupabaseConfig } from "@/lib/supabase/config";

// The one place that decides which backend serves a request.
//   * default            -> Supabase (config is validated; fails closed)
//   * APP_BACKEND=mock   -> in-memory dev/test backend, ONLY when not on Vercel
//                           production. It is never an automatic fallback.

export type BackendMode =
  | { mode: "supabase" }
  | { mode: "mock" }
  | { mode: "unconfigured"; reason: string }
  | { mode: "refused"; reason: string };

export function resolveBackendMode(env: Record<string, string | undefined> = process.env): BackendMode {
  if (env.APP_BACKEND === "mock") {
    if (env.VERCEL_ENV === "production") {
      return { mode: "refused", reason: "APP_BACKEND=mock is a development/test setting and is refused on production deployments." };
    }
    return { mode: "mock" };
  }
  const config = getSupabaseConfig();
  return config.ok ? { mode: "supabase" } : { mode: "unconfigured", reason: config.reason };
}

export async function getBackend(): Promise<Backend> {
  const resolved = resolveBackendMode();
  if (resolved.mode === "mock") {
    const jar = await cookies();
    return createMockBackend({
      get: () => jar.get(MOCK_COOKIE)?.value ?? null,
      set: (id) => {
        try {
          if (id) jar.set(MOCK_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/" });
          else jar.delete(MOCK_COOKIE);
        } catch {
          // cookies are read-only while rendering; sign-in/out run in Server Actions / Route Handlers
        }
      },
    });
  }
  if (resolved.mode === "supabase") return createSupabaseBackend();
  throw new BackendError("unavailable", resolved.reason, resolved.mode);
}
