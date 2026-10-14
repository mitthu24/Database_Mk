import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { Table2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateTableDialog } from "@/components/tables/create-table-dialog";
import { requireContext } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";

export const metadata = { title: "Tables" };

function accessBadge(access: { view: boolean; manage: boolean }, companyAccess: string) {
  if (companyAccess === "suspended") return <Badge variant="destructive">Suspended</Badge>;
  if (companyAccess === "read_only") return <Badge variant="secondary">Read only</Badge>;
  if (access.manage) return <Badge variant="accent">Manage</Badge>;
  return <Badge variant="outline">View</Badge>;
}

async function TablesContent() {
  await connection();
  const ctx = await requireContext();
  if (ctx.isFounder) redirect("/founder");
  if (!ctx.companyId) redirect("/onboarding");

  const backend = await getBackend();
  const tables = await backend.data.listTables();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Tables</h1>
          <p className="text-sm text-muted-foreground">{tables.length} of up to 100 tables.</p>
        </div>
        {ctx.role === "admin" && ctx.access === "full" ? <CreateTableDialog /> : null}
      </div>

      {tables.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Table2 aria-hidden />
            </span>
            <CardTitle className="text-base">No tables yet</CardTitle>
            <CardDescription>
              {ctx.role === "admin" && ctx.access === "full"
                ? "Create your first table to start tracking data."
                : "Ask your company administrator to create a table and grant you access."}
            </CardDescription>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {tables.map((t) => (
            <Link key={t.id} href={`/tables/${t.id}`} className="block">
              <Card className="h-full transition-colors hover:border-accent/50">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{t.name}</CardTitle>
                    {accessBadge(t.access, ctx.access)}
                  </div>
                  <CardDescription>
                    {t.rowCount.toLocaleString()} {t.rowCount === 1 ? "row" : "rows"} &middot; {t.columns.length} {t.columns.length === 1 ? "column" : "columns"}
                  </CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function TablesFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-32" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    </div>
  );
}

export default function TablesPage() {
  return (
    <Suspense fallback={<TablesFallback />}>
      <TablesContent />
    </Suspense>
  );
}
