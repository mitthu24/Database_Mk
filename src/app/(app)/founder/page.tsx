import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFounder } from "@/lib/auth/dal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Founder console" };

async function FounderContent() {
  await requireFounder(); // authorization: database-derived, not cookie/claim-derived

  // RLS lets only a founder count other companies; this doubles as a live check.
  const supabase = await createClient();
  const { count } = await supabase.from("companies").select("id", { count: "exact", head: true });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Founder console</CardTitle>
        <CardDescription>Company management, plans and payments arrive in a later milestone.</CardDescription>
      </CardHeader>
      <CardContent className="pb-6 text-sm">
        Companies on the platform: <span className="font-medium">{count ?? "unknown"}</span>
      </CardContent>
    </Card>
  );
}

export default function FounderPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-muted" aria-hidden />}>
      <FounderContent />
    </Suspense>
  );
}
