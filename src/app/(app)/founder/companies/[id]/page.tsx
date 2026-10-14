import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CompanyStatusControl } from "@/components/founder/company-status-control";
import { PaymentReviewControl } from "@/components/founder/payment-review-control";
import { SubscriptionControl } from "@/components/founder/subscription-control";
import { requireFounder } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";

export const metadata = { title: "Company detail" };

const ACCESS_VARIANT = { full: "accent", read_only: "secondary", suspended: "destructive" } as const;
const STATUS_VARIANT = { pending: "secondary", approved: "accent", rejected: "destructive" } as const;

async function CompanyDetailContent({ id }: { id: string }) {
  await connection();
  await requireFounder();
  const backend = await getBackend();
  const [detail, members] = await Promise.all([
    backend.data.founderCompanyDetail(id).catch(() => null),
    backend.data.founderListMembers(id),
  ]);
  if (!detail) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{detail.name}</h1>
            <Badge variant={ACCESS_VARIANT[detail.access]}>{detail.access.replace("_", " ")}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Created {new Date(detail.createdAt).toLocaleDateString()}</p>
        </div>
        <CompanyStatusControl companyId={detail.id} status={detail.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 pb-6 text-sm">
            <p>Contact email: {detail.contactEmail ?? "—"}</p>
            <p>Phone: {detail.phone ?? "—"}</p>
            <p>Address: {detail.address ?? "—"}</p>
            <p className="mt-2">
              {detail.members} members &middot; {detail.tables} tables &middot; {detail.rows.toLocaleString()} rows
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Subscription</CardTitle>
            <CardDescription>
              {detail.subscription.plan ?? "—"} / {detail.subscription.status ?? "—"}
              {detail.subscription.trialEndsAt ? ` · trial ends ${new Date(detail.subscription.trialEndsAt).toLocaleDateString()}` : null}
              {detail.subscription.currentPeriodEnd ? ` · period ends ${new Date(detail.subscription.currentPeriodEnd).toLocaleDateString()}` : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="pb-6">
            <SubscriptionControl companyId={detail.id} trialEndsAt={detail.subscription.trialEndsAt} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto pb-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Code</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>{m.fullName ?? "—"}</TableCell>
                  <TableCell>{m.email ?? "—"}</TableCell>
                  <TableCell className="capitalize">{m.role}</TableCell>
                  <TableCell className="capitalize">{m.status}</TableCell>
                  <TableCell>{m.employeeCode ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payments</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto pb-6">
          {detail.payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments submitted.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Submitted</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.payments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {p.currency} / {p.months}mo
                    </TableCell>
                    <TableCell>{p.reference}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge>
                    </TableCell>
                    <TableCell>{p.status === "pending" ? <PaymentReviewControl paymentId={p.id} /> : null}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CompanyDetailFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<CompanyDetailFallback />}>
      <CompanyDetailContent id={id} />
    </Suspense>
  );
}
