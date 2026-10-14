import { Suspense } from "react";

import { connection } from "next/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PaymentHistory } from "@/components/billing/payment-history";
import { SubmitPaymentForm } from "@/components/billing/submit-payment-form";
import { trialDaysLeft } from "@/lib/auth/context";
import { requireCompanyMember } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";

export const metadata = { title: "Billing" };

function StatusBanner({
  access,
  subscriptionStatus,
  daysLeft,
}: {
  access: string;
  subscriptionStatus: string | null;
  daysLeft: number | null;
}) {
  if (access === "suspended") {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        This company is suspended. Your data is unavailable until the founder restores access. Contact support for help.
      </p>
    );
  }
  if (access === "read_only") {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {subscriptionStatus === "trialing" ? "Your free trial has ended." : "Your subscription is not active."} Your
        data is read-only (you can still view and export it) until a payment is approved.
      </p>
    );
  }
  if (daysLeft !== null && daysLeft <= 7) {
    return (
      <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
        Your free trial ends in {daysLeft} {daysLeft === 1 ? "day" : "days"}. Submit a payment below to keep full access.
      </p>
    );
  }
  return null;
}

async function BillingContent() {
  await connection();
  const ctx = await requireCompanyMember();
  const backend = await getBackend();
  const settings = await backend.data.getPlatformSettings();
  // Payment history is admin/founder-visible by backend design; an employee
  // calling listPayments() would simply get none back, so skip the call.
  const payments = ctx.role === "admin" ? await backend.data.listPayments() : [];
  const daysLeft = trialDaysLeft(ctx, new Date());
  const canSubmit = ctx.role === "admin" && ctx.access !== "suspended";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="text-sm text-muted-foreground">
          {ctx.plan === "trial" ? "Free trial" : "Standard plan"}
          {ctx.subscriptionStatus === "active" && ctx.currentPeriodEnd
            ? ` · renews ${new Date(ctx.currentPeriodEnd).toLocaleDateString()}`
            : null}
        </p>
      </div>

      <StatusBanner access={ctx.access} subscriptionStatus={ctx.subscriptionStatus} daysLeft={daysLeft} />

      {canSubmit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Submit a payment</CardTitle>
            <CardDescription>
              {settings.payment_instructions ?? "Payment instructions have not been set up yet. Contact support."}
              {settings.support_email ? ` Questions: ${settings.support_email}.` : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-6">
            <SubmitPaymentForm />
          </CardContent>
        </Card>
      ) : ctx.role !== "admin" ? (
        <p className="text-sm text-muted-foreground">Only your company administrator can submit a payment.</p>
      ) : null}

      {ctx.role === "admin" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payment history</CardTitle>
          </CardHeader>
          <CardContent className="pb-6">
            <PaymentHistory payments={payments} />
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function BillingFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense fallback={<BillingFallback />}>
      <BillingContent />
    </Suspense>
  );
}
