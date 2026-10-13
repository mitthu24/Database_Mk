import { NextResponse, type NextRequest } from "next/server";

import { getBackend } from "@/lib/backend";
import { BackendError } from "@/lib/backend/port";
import { safeNextPath } from "@/lib/auth/validation";

// Landing point of email links (confirmation, invite, password reset - PKCE):
// exchanges the one-time code for a session, then sends the user on. `next` is
// restricted to same-origin relative paths to prevent open redirects.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"), "/onboarding");

  if (code) {
    try {
      const backend = await getBackend();
      if (await backend.auth.exchangeCode(code)) return NextResponse.redirect(`${origin}${next}`);
    } catch (error) {
      if (error instanceof BackendError && error.kind === "unavailable") {
        return NextResponse.redirect(`${origin}/unavailable`);
      }
      throw error;
    }
  }

  return NextResponse.redirect(`${origin}/login?error=link`);
}
