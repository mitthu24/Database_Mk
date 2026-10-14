import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { AddEmployeeDialog } from "@/components/employees/add-employee-dialog";
import { MemberRoleControl, MemberStatusControl } from "@/components/employees/member-row-controls";
import { PermissionsDialog } from "@/components/employees/permissions-dialog";
import { requireContext } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";

export const metadata = { title: "Employees" };

async function EmployeesContent() {
  await connection();
  const ctx = await requireContext();
  if (ctx.isFounder) redirect("/founder");
  if (!ctx.companyId) redirect("/onboarding");
  if (ctx.role !== "admin") redirect("/dashboard");

  const backend = await getBackend();
  const [members, tables] = await Promise.all([backend.data.listMembers(), backend.data.listTables()]);
  const tableRefs = tables.map((t) => ({ id: t.id, name: t.name }));

  // Permissions are fetched once per employee up-front (small company-scale
  // lists) so the dialog opens instantly with no extra round trip.
  const permissionsByUser = new Map<string, Awaited<ReturnType<typeof backend.data.listPermissions>>>();
  for (const m of members) {
    if (m.role === "employee") {
      permissionsByUser.set(m.userId, await backend.data.listPermissions(m.userId));
    }
  }

  const canWrite = ctx.access === "full";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Employees</h1>
          <p className="text-sm text-muted-foreground">{members.length} member{members.length === 1 ? "" : "s"}.</p>
        </div>
        {canWrite ? <AddEmployeeDialog /> : null}
      </div>

      {!canWrite ? (
        <p role="status" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
          Your company is read-only right now, so employees cannot be added or changed.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Tables</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">{m.fullName ?? "—"}</TableCell>
                <TableCell>{m.email ?? "—"}</TableCell>
                <TableCell>{m.employeeCode ? <Badge variant="outline">{m.employeeCode}</Badge> : "—"}</TableCell>
                <TableCell>
                  <MemberRoleControl member={m} disabled={!canWrite || m.userId === ctx.userId} />
                </TableCell>
                <TableCell>
                  <MemberStatusControl member={m} disabled={!canWrite || m.userId === ctx.userId} />
                </TableCell>
                <TableCell>{m.role === "admin" ? "All" : m.tablesWithAccess}</TableCell>
                <TableCell>
                  {m.role === "employee" && canWrite ? (
                    <PermissionsDialog member={m} tables={tableRefs} initialPermissions={permissionsByUser.get(m.userId) ?? []} />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function EmployeesFallback() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

export default function EmployeesPage() {
  return (
    <Suspense fallback={<EmployeesFallback />}>
      <EmployeesContent />
    </Suspense>
  );
}
