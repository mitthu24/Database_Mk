import { NextResponse, type NextRequest } from "next/server";

import { resolveGuard } from "@/lib/auth/route-guard";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  const { response, isAuthenticated, supabaseConfigured } = await updateSession(request);

  const decision = resolveGuard({
    pathname: request.nextUrl.pathname,
    isAuthenticated,
    supabaseConfigured,
  });

  if (decision.action === "redirect") {
    const redirect = NextResponse.redirect(new URL(decision.to, request.url));
    // Keep any refreshed session cookies on the redirect response.
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
