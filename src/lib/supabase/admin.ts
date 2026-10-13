import "server-only";

import { createClient } from "@supabase/supabase-js";

import { requireSupabaseConfig } from "@/lib/supabase/config";

// Service-role client: bypasses RLS. Server-side only (the "server-only" import
// makes the build fail if this module is ever pulled into a client bundle).
// Every caller must authorize the acting user BEFORE using it.
export function createAdminClient() {
  const { url } = requireSupabaseConfig(); // same fail-closed project check as the anon client
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error("Supabase service-role client is not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
