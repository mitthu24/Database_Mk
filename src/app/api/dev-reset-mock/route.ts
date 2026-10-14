import { NextResponse } from "next/server";

import { resolveBackendMode } from "@/lib/backend/mode";
import { resetMockPasswords } from "@/lib/backend/mock/auth-port";
import { resetMockStore } from "@/lib/backend/mock/store";

// Dev/test-only: resets the in-memory mock store to its deterministic seed.
// 404s unless APP_BACKEND=mock (which itself is refused on production — see
// resolveBackendMode). Used by the Playwright suite to isolate tests from
// each other's writes; never reachable against the Supabase backend.
export async function POST() {
  if (resolveBackendMode().mode !== "mock") {
    return NextResponse.json({ message: "Not found." }, { status: 404 });
  }
  resetMockStore();
  resetMockPasswords();
  return NextResponse.json({ ok: true });
}
