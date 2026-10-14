import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { CompanyProfileForm } from "@/components/company/company-profile-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireContext } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";

export const metadata = { title: "Company profile" };

async function CompanyContent() {
  await connection();
  const ctx = await requireContext();
  if (ctx.isFounder || !ctx.companyId) redirect("/dashboard");

  const backend = await getBackend();
  const profile = await backend.data.getCompanyProfile();
  if (!profile) redirect("/dashboard");

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">Company profile</CardTitle>
        <CardDescription>
          {ctx.role === "admin" ? "Visible to your team and used for billing contact." : "Visible to your team."}
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-6">
        <CompanyProfileForm profile={profile} canEdit={ctx.role === "admin" && ctx.access === "full"} />
      </CardContent>
    </Card>
  );
}

export default function CompanyPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-96 max-w-md animate-pulse rounded-xl bg-muted" aria-hidden />}>
      <CompanyContent />
    </Suspense>
  );
}
