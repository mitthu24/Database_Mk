import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PaymentReviewControl } from "@/components/founder/payment-review-control";
import { requireFounder } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";
import type { PaymentStatus } from "@/lib/backend/types";

export const metadata = { title: "Payments" };

const STATUS_VARIANT = { pending: "secondary", approved: "accent", rejected: "destructive" } as const;
const PAGE_SIZE = 25;

async function PaymentsContent({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await connection();
  await requireFounder();
  const params = await searchParams;
  const status = (typeof params.status === "string" ? params.status : "pending") as PaymentStatus | "all";
  const page = Math.max(0, Number(params.page) || 0);

  const backend = await getBackend();
  const result = await backend.data.founderListPayments(status === "all" ? undefined : status, PAGE_SIZE, page * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const tabs: { key: PaymentStatus | "all"; label: string }[] = [
    { key: "pending", label: "Pending" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "all", label: "All" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Payments</h1>
        <p className="text-sm text-muted-foreground">{result.total.toLocaleString()} matching.</p>
      </div>

      <nav className="flex items-center gap-2">
        {tabs.map((t) => (
          <Button key={t.key} asChild variant={status === t.key ? "default" : "outline"} size="sm">
            <Link href={`/founder/payments?status=${t.key}`}>{t.label}</Link>
          </Button>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Submitted</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No payments.
                </TableCell>
              </TableRow>
            ) : (
              result.rows.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <Link href={`/founder/companies/${p.companyId}`} className="underline-offset-4 hover:underline">
                      {p.companyName ?? p.companyId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {p.currency} / {p.months}mo
                  </TableCell>
                  <TableCell>{p.reference}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge>
                  </TableCell>
                  <TableCell>{p.status === "pending" ? <PaymentReviewControl paymentId={p.id} /> : null}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          Page {page + 1} of {totalPages}
        </span>
        <div className="flex items-center gap-2">
          {page === 0 ? (
            <Button variant="outline" size="sm" disabled>
              Previous
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={`/founder/payments?status=${status}&page=${page - 1}`}>Previous</Link>
            </Button>
          )}
          {page + 1 >= totalPages ? (
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={`/founder/payments?status=${status}&page=${page + 1}`}>Next</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function PaymentsFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default function PaymentsPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  return (
    <Suspense fallback={<PaymentsFallback />}>
      <PaymentsContent searchParams={searchParams} />
    </Suspense>
  );
}
