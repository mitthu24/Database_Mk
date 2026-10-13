import "server-only";

import type { Backend } from "@/lib/backend/port";
import { createSupabaseAuthAdminPort, createSupabaseAuthPort, createSupabaseDataPort } from "@/lib/backend/supabase-ports";
import { createClient } from "@/lib/supabase/server";

export async function createSupabaseBackend(): Promise<Backend> {
  const client = await createClient();
  return {
    kind: "supabase",
    auth: createSupabaseAuthPort(client),
    data: createSupabaseDataPort(client),
    authAdmin: createSupabaseAuthAdminPort(),
  };
}
