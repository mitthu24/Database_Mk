import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CreateCompanyDialog } from "@/components/founder/create-company-dialog";
import { requireFounder } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";
import type { CompanyState } from "@/lib/backend/types";

export const metadata = { title: "Companies" };

const ACCESS_VARIANT = { full: "accent", read_only: "secondary", suspended: "destructive" } as const;
const PAGE_SIZE = 20;

async function CompaniesContent({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  await connection();
  await requireFounder();
  const params = await searchParams;
  const search = typeof params.q === "string" ? params.q : "";
  const state = (typeof params.state === "string" ? params.state : "all") as CompanyState;
  const page = Math.max(0, Number(params.page) || 0);

  const backend = await getBackend();
  const result = await backend.data.founderListCompanies({ search: search || undefined, state, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const buildHref = (overrides: Record<string, string | number>) => {
    const next = new URLSearchParams();
    if (search) next.set("q", search);
    if (state !== "all") next.set("state", state);
    if (page) next.set("page", String(page));
    for (const [k, v] of Object.entries(overrides)) {
      if (v === "" || v === 0 || v === "all") next.delete(k);
      else next.set(k, String(v));
    }
    const qs = next.toString();
    return qs ? `/founder/companies?${qs}` : "/founder/companies";
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Companies</h1>
          <p className="text-sm text-muted-foreground">{result.total.toLocaleString()} total.</p>
        </div>
        <CreateCompanyDialog />
      </div>

      <form className="flex flex-wrap items-center gap-3" action="/founder/companies">
        <Input name="q" defaultValue={search} placeholder="Search by name or admin email…" className="max-w-xs" />
        <Select name="state" defaultValue={state}>
          <SelectTrigger className="w-44" aria-label="Filter by company state">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All states</SelectItem>
            <SelectItem value="trialing">Trialing</SelectItem>
            <SelectItem value="active">Active (paid)</SelectItem>
            <SelectItem value="expired">Expired trial</SelectItem>
            <SelectItem value="suspended">Suspended</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Company</TableHead>
              <TableHead>Admin</TableHead>
              <TableHead>Plan</TableHead>
              <TableHead>Access</TableHead>
              <TableHead>Members</TableHead>
              <TableHead>Tables</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                  No companies match.
                </TableCell>
              </TableRow>
            ) : (
              result.rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <Link href={`/founder/companies/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell>{c.adminEmail ?? "—"}</TableCell>
                  <TableCell className="capitalize">{c.subscriptionStatus ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={ACCESS_VARIANT[c.access]}>{c.access.replace("_", " ")}</Badge>
                  </TableCell>
                  <TableCell>{c.members}</TableCell>
                  <TableCell>{c.tables}</TableCell>
                  <TableCell>{new Date(c.createdAt).toLocaleDateString()}</TableCell>
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
              <Link href={buildHref({ page: page - 1 })}>Previous</Link>
            </Button>
          )}
          {page + 1 >= totalPages ? (
            <Button variant="outline" size="sm" disabled>
              Next
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href={buildHref({ page: page + 1 })}>Next</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CompaniesFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default function CompaniesPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  return (
    <Suspense fallback={<CompaniesFallback />}>
      <CompaniesContent searchParams={searchParams} />
    </Suspense>
  );
}
