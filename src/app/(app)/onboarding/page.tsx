import { redirect } from "next/navigation";
import { Suspense } from "react";

import { CompanyForm } from "@/components/auth/company-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthUser, requireContext } from "@/lib/auth/dal";

export const metadata = { title: "Create your company" };

async function OnboardingContent() {
  const ctx = await requireContext();
  if (ctx.isFounder || ctx.companyId) redirect("/dashboard");

  const user = await getAuthUser();
  const suggestion = user?.user_metadata?.pending_company_name;

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">Create your company</CardTitle>
        <CardDescription>Your 30-day free trial starts when the company is created.</CardDescription>
      </CardHeader>
      <CardContent className="pb-6">
        <CompanyForm defaultName={typeof suggestion === "string" ? suggestion : undefined} />
      </CardContent>
    </Card>
  );
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-48 max-w-md animate-pulse rounded-xl bg-muted" aria-hidden />}>
      <OnboardingContent />
    </Suspense>
  );
}
