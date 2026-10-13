import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { resolveBackendMode } from "@/lib/backend/mode";
import { MOCK_COOKIE } from "@/lib/backend/mock/store";
import { getSupabaseConfig } from "@/lib/supabase/config";

export type SessionRefresh = {
  response: NextResponse;
  isAuthenticated: boolean;
  supabaseConfigured: boolean;
};

// Refreshes the Supabase session cookies on every matched request.
// isAuthenticated is an OPTIMISTIC signal (verified JWT claims) used only for
// redirects in src/proxy.ts; it is not an authorization decision.
export async function updateSession(request: NextRequest): Promise<SessionRefresh> {
  let response = NextResponse.next({ request });

  // Explicit dev/test backend: the session is just the mock cookie.
  const mode = resolveBackendMode();
  if (mode.mode === "mock") {
    return { response, isAuthenticated: Boolean(request.cookies.get(MOCK_COOKIE)?.value), supabaseConfigured: true };
  }

  const config = getSupabaseConfig();

  if (!config.ok) {
    // Missing or REJECTED configuration (e.g. a preview pointing at production):
    // behave as unconfigured so protected routes fail closed.
    return { response, isAuthenticated: false, supabaseConfigured: false };
  }

  const supabase = createServerClient(config.url, config.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  const { data } = await supabase.auth.getClaims();

  return {
    response,
    isAuthenticated: Boolean(data?.claims?.sub),
    supabaseConfigured: true,
  };
}
