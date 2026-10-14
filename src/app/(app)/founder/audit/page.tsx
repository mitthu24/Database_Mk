import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireFounder } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";

export const metadata = { title: "Audit log" };

const PAGE_SIZE = 50;

async function AuditContent({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await connection();
  await requireFounder();
  const params = await searchParams;
  const page = Math.max(0, Number(params.page) || 0);

  const backend = await getBackend();
  const result = await backend.data.founderAudit({ limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Audit log</h1>
        <p className="text-sm text-muted-foreground">{result.total.toLocaleString()} events, platform-wide.</p>
      </div>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Actor</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No events yet.
                </TableCell>
              </TableRow>
            ) : (
              result.rows.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap">{new Date(e.createdAt).toLocaleString()}</TableCell>
                  <TableCell>{e.companyName ?? "—"}</TableCell>
                  <TableCell>{e.actorEmail ?? "system"}</TableCell>
                  <TableCell className="font-mono text-xs">{e.action}</TableCell>
                  <TableCell className="max-w-72 truncate text-xs text-muted-foreground" title={JSON.stringify(e.metadata)}>
                    {Object.keys(e.metadata).length > 0 ? JSON.stringify(e.metadata) : "—"}
                  </TableCell>
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
              <Link href={`/founder/audit?page=${page - 1}`}>Previous</Link>
            </Button>
          )}
          {page + 1 >= totalPages ? (
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={`/founder/audit?page=${page + 1}`}>Next</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function AuditFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default function AuditPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  return (
    <Suspense fallback={<AuditFallback />}>
      <AuditContent searchParams={searchParams} />
    </Suspense>
  );
}
