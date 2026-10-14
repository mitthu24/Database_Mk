"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Member, PermissionFlags, TablePermission } from "@/lib/backend/types";
import { setTablePermission } from "@/lib/employees/actions";

const PERM_KEYS = [
  ["view", "View"],
  ["create", "Create"],
  ["edit", "Edit"],
  ["delete", "Delete"],
  ["import", "Import"],
  ["export", "Export"],
] as const;

type Row = { tableId: string; tableName: string } & PermissionFlags;

function toRows(tables: { id: string; name: string }[], existing: TablePermission[]): Row[] {
  const byTable = new Map(existing.map((p) => [p.tableId, p]));
  return tables.map((t) => {
    const p = byTable.get(t.id);
    return {
      tableId: t.id,
      tableName: t.name,
      view: p?.canView ?? false,
      create: p?.canCreate ?? false,
      edit: p?.canEdit ?? false,
      delete: p?.canDelete ?? false,
      import: p?.canImport ?? false,
      export: p?.canExport ?? false,
    };
  });
}

export function PermissionsDialog({
  member,
  tables,
  initialPermissions,
}: {
  member: Member;
  tables: { id: string; name: string }[];
  initialPermissions: TablePermission[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <ShieldCheck aria-hidden /> Permissions
        </Button>
      </DialogTrigger>
      {open ? <PermissionsContent member={member} tables={tables} initialPermissions={initialPermissions} onOpenChange={setOpen} /> : null}
    </Dialog>
  );
}

function PermissionsContent({
  member,
  tables,
  initialPermissions,
  onOpenChange,
}: {
  member: Member;
  tables: { id: string; name: string }[];
  initialPermissions: TablePermission[];
  onOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => toRows(tables, initialPermissions));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function toggle(tableId: string, key: keyof PermissionFlags, checked: boolean) {
    setRows((rs) =>
      rs.map((r) => {
        if (r.tableId !== tableId) return r;
        const next = { ...r, [key]: checked };
        // Any operation implies view; turning view off clears the rest.
        if (key === "view" && !checked) return { ...next, create: false, edit: false, delete: false, import: false, export: false };
        if (key !== "view" && checked) next.view = true;
        return next;
      }),
    );
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const before = toRows(tables, initialPermissions);
    const changed = rows.filter((r, i) => JSON.stringify(r) !== JSON.stringify(before[i]));
    for (const r of changed) {
      const result = await setTablePermission(member.userId, r.tableId, {
        view: r.view,
        create: r.create,
        edit: r.edit,
        delete: r.delete,
        import: r.import,
        export: r.export,
      });
      if (!result.ok) {
        setSaving(false);
        setMessage(`${r.tableName}: ${result.message}`);
        return;
      }
    }
    setSaving(false);
    toast.success("Permissions updated.");
    onOpenChange(false);
  }

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Permissions for {member.fullName ?? member.email}</DialogTitle>
        <DialogDescription>Any operation other than view also grants view. Unchecking view clears everything else for that table.</DialogDescription>
      </DialogHeader>

      {message ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p> : null}

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">This company has no tables yet.</p>
      ) : (
        <div className="max-h-96 overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Table</TableHead>
                {PERM_KEYS.map(([key, label]) => (
                  <TableHead key={key} className="text-center">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.tableId}>
                  <TableCell className="font-medium">{r.tableName}</TableCell>
                  {PERM_KEYS.map(([key]) => (
                    <TableCell key={key} className="text-center">
                      <Checkbox checked={r[key]} onCheckedChange={(c) => toggle(r.tableId, key, c === true)} aria-label={`${key} on ${r.tableName}`} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <DialogFooter>
        <Button onClick={save} disabled={saving || rows.length === 0}>
          {saving ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {saving ? "Saving…" : "Save permissions"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
