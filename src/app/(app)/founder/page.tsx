import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { BarChart } from "@/components/founder/bar-chart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { requireFounder } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";

export const metadata = { title: "Founder console" };

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1 pt-6 pb-5">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-semibold">{value.toLocaleString()}</p>
      </CardContent>
    </Card>
  );
}

async function FounderContent() {
  await connection();
  await requireFounder();
  const backend = await getBackend();
  const overview = await backend.data.founderOverview();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Founder console</h1>
          <p className="text-sm text-muted-foreground">Platform-wide overview across every company.</p>
        </div>
        <nav className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/founder/companies">Companies</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/founder/payments">Payments</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/founder/audit">Audit log</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/founder/settings">Settings</Link>
          </Button>
        </nav>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Companies" value={overview.companiesTotal} />
        <Stat label="Trialing" value={overview.trialing} />
        <Stat label="Active (paid)" value={overview.activePaid} />
        <Stat label="Expired trial" value={overview.expired} />
        <Stat label="Suspended" value={overview.suspended} />
        <Stat label="Trials ending ≤7d" value={overview.trialsEnding7d} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Members" value={overview.membersTotal} />
        <Stat label="Tables" value={overview.tablesTotal} />
        <Stat label="Rows" value={overview.rowsTotal} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Signups by month</CardTitle>
            <CardDescription>Companies registered, last 6 months.</CardDescription>
          </CardHeader>
          <CardContent className="pb-6">
            {overview.signupsByMonth.every((m) => m.count === 0) ? (
              <p className="text-sm text-muted-foreground">No signups yet.</p>
            ) : (
              <BarChart data={overview.signupsByMonth.map((m) => ({ label: m.month.slice(5), value: m.count }))} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Payments pending review</CardTitle>
            <CardDescription>
              {overview.paymentsPending} pending &middot; approved in the last 30 days:
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pb-6">
            {overview.paymentsApproved30d.length === 0 ? (
              <p className="text-sm text-muted-foreground">No approved payments in the last 30 days.</p>
            ) : (
              <ul className="text-sm">
                {overview.paymentsApproved30d.map((p) => (
                  <li key={p.currency}>
                    {p.total.toLocaleString(undefined, { minimumFractionDigits: 2 })} {p.currency}
                  </li>
                ))}
              </ul>
            )}
            <Button asChild variant="accent" className="self-start">
              <Link href="/founder/payments">Review payments</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function FounderFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-3 gap-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    </div>
  );
}

export default function FounderPage() {
  return (
    <Suspense fallback={<FounderFallback />}>
      <FounderContent />
    </Suspense>
  );
}
