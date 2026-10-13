import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    // Not configured yet: let public pages (e.g. /setup) render instead of crashing.
    return { response, isAuthenticated: false, supabaseConfigured: false };
  }

  const supabase = createServerClient(url, anonKey, {
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
