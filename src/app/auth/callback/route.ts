import { NextResponse, type NextRequest } from "next/server";

import { safeNextPath } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/server";

// Landing point of the email-confirmation link (PKCE flow): exchanges the
// one-time code for a session cookie, then sends the user on. `next` is
// restricted to same-origin relative paths to prevent open redirects.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), "/onboarding");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
  }

  return NextResponse.redirect(`${origin}/login?error=confirmation`);
}
