import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireFounder } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";

export const metadata = { title: "Founder console" };

async function FounderContent() {
  await requireFounder(); // authorization: database-derived, not cookie/claim-derived

  const backend = await getBackend();
  const overview = await backend.data.founderOverview();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Founder console</CardTitle>
        <CardDescription>The full dashboard, company directory and payment review arrive in a later milestone.</CardDescription>
      </CardHeader>
      <CardContent className="pb-6 text-sm">
        Companies on the platform: <span className="font-medium">{overview.companiesTotal}</span>
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
