import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trialDaysLeft, type AppContext } from "@/lib/auth/context";
import { requireContext } from "@/lib/auth/dal";

export const metadata = { title: "Dashboard" };

function Banner({ ctx }: { ctx: AppContext }) {
  switch (ctx.access) {
    case "disabled":
      return (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Your account has been disabled. Contact your company administrator.
        </p>
      );
    case "suspended":
      return (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          This company is suspended and its data is unavailable. Contact support to restore access.
        </p>
      );
    case "read_only":
      return (
        <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          {ctx.subscriptionStatus === "trialing"
            ? "Your free trial has ended."
            : "Your subscription is not active."}{" "}
          Your data is available read-only. {ctx.role === "admin" ? "Contact us to activate a plan." : "Ask your administrator to activate a plan."}
        </p>
      );
    default:
      return null;
  }
}

async function DashboardContent() {
  await connection();
  const ctx = await requireContext();

  if (!ctx.isFounder && !ctx.companyId) redirect("/onboarding");

  const daysLeft = trialDaysLeft(ctx, new Date());

  return (
    <div className="flex flex-col gap-4">
      <Banner ctx={ctx} />

      {ctx.isFounder ? (
        <Card>
          <CardHeader>
            <CardTitle>Platform founder</CardTitle>
            <CardDescription>You manage companies, plans and the platform audit log.</CardDescription>
          </CardHeader>
          <CardContent className="pb-6">
            <Button asChild variant="accent">
              <Link href="/founder">Open founder console</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex flex-col gap-1.5">
                <CardTitle className="text-xl">{ctx.companyName}</CardTitle>
                <CardDescription>
                  Signed in as {ctx.role === "admin" ? "company administrator" : "employee"}
                </CardDescription>
              </div>
              <Badge variant={ctx.access === "full" ? "accent" : "secondary"}>
                {ctx.access === "full" ? "Active" : ctx.access.replace("_", " ")}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pb-6 text-sm text-muted-foreground">
            {daysLeft !== null && ctx.access === "full" ? (
              <p>
                Free trial: <span className="font-medium text-foreground">{daysLeft} {daysLeft === 1 ? "day" : "days"}</span> remaining.
              </p>
            ) : null}
            <Button asChild variant="accent" className="self-start">
              <Link href="/tables">Open tables</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="h-40 animate-pulse rounded-xl bg-muted" aria-hidden />}>
      <DashboardContent />
    </Suspense>
  );
}
