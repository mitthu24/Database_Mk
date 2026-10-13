import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
