import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { TableGrid } from "@/components/tables/table-grid";
import { requireContext } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";

async function TableDetail({ id }: { id: string }) {
  await connection();
  const ctx = await requireContext();
  if (ctx.isFounder) redirect("/founder");
  if (!ctx.companyId) redirect("/onboarding");

  const backend = await getBackend();
  const table = await backend.data.getTable(id);
  if (!table) notFound();

  return <TableGrid table={table} companyAccess={ctx.access} />;
}

function TableDetailFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-10 w-full max-w-xs" />
      <Skeleton className="h-96 w-full" />
    </div>
  );
}

export default async function TableDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense fallback={<TableDetailFallback />}>
      <TableDetail id={id} />
    </Suspense>
  );
}
