import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportHistory } from "@/components/tables/import-history";
import { ImportWizard } from "@/components/tables/import-wizard";
import { requireContext } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";

export const metadata = { title: "Import data" };

async function ImportContent({ id }: { id: string }) {
  const ctx = await requireContext();
  if (ctx.isFounder) redirect("/founder");
  if (!ctx.companyId) redirect("/onboarding");

  const backend = await getBackend();
  const table = await backend.data.getTable(id);
  if (!table) notFound();
  if (!table.access.import && !table.access.manage) redirect(`/tables/${id}`);

  const jobs = await backend.data.listImportJobs(id, 10);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">Import into &ldquo;{table.name}&rdquo;</h1>
        <p className="text-sm text-muted-foreground">
          Upload a CSV, XLSX or JSON file. You will review a preview, the column mapping, and any issues before
          anything is saved.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload a file</CardTitle>
          <CardDescription>Rows are validated against this table&apos;s current columns.</CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          <ImportWizard tableId={id} columns={table.columns} canReplace={table.access.manage} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent imports</CardTitle>
        </CardHeader>
        <CardContent className="pb-6">
          <ImportHistory jobs={jobs} />
        </CardContent>
      </Card>
    </div>
  );
}

function ImportFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<ImportFallback />}>
      <ImportContent id={id} />
    </Suspense>
  );
}
