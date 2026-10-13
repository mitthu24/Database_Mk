"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ColumnDef, JsonPrimitive, RowData, RowRecord } from "@/lib/data/types";
import { insertRow, updateRow } from "@/lib/tables/actions";

// Local, client-safe coercion (text input -> typed value). Deliberately NOT
// shared with the import pipeline's coerceCell, which pulls in ExcelJS/Papa
// and would bloat this client bundle; the server re-validates regardless.
function coerce(raw: string, type: ColumnDef["type"]): JsonPrimitive {
  const s = raw.trim();
  if (s === "") return null;
  switch (type) {
    case "number":
    case "integer": {
      const n = Number(s);
      return Number.isFinite(n) ? n : s; // let the server reject a bad number with its own message
    }
    default:
      return s;
  }
}

function fieldValue(data: RowData, col: ColumnDef): string {
  const v = data[col.key];
  if (v === null || v === undefined) return "";
  return String(v);
}

export function RowFormDialog({
  open,
  onOpenChange,
  tableId,
  columns,
  row,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableId: string;
  columns: ColumnDef[];
  row: RowRecord | null;
  onSaved: () => void;
}) {
  // The dialog unmounts its content on close (Radix default), so each open is
  // a fresh mount: lazy initial state from props needs no effect.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <RowFormContent tableId={tableId} columns={columns} row={row} onSaved={onSaved} onOpenChange={onOpenChange} /> : null}
    </Dialog>
  );
}

function RowFormContent({
  tableId,
  columns,
  row,
  onSaved,
  onOpenChange,
}: {
  tableId: string;
  columns: ColumnDef[];
  row: RowRecord | null;
  onSaved: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const init: Record<string, string | boolean> = {};
    for (const col of columns) {
      init[col.key] = col.type === "boolean" ? Boolean(row?.data[col.key]) : fieldValue(row?.data ?? {}, col);
    }
    return init;
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setMessage(undefined);

    const data: RowData = {};
    for (const col of columns) {
      const v = values[col.key];
      data[col.key] = col.type === "boolean" ? Boolean(v) : coerce(typeof v === "string" ? v : "", col.type);
    }

    const result = row ? await updateRow(tableId, row.id, data) : await insertRow(tableId, data);
    setPending(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    toast.success(row ? "Row updated." : "Row added.");
    onOpenChange(false);
    onSaved();
  }

  return (
    <DialogContent className="sm:max-w-lg">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <DialogHeader>
            <DialogTitle>{row ? "Edit row" : "Add row"}</DialogTitle>
            <DialogDescription>{row ? "Changes are saved to this row only." : "Fill in the fields you have. You can leave the rest blank."}</DialogDescription>
          </DialogHeader>

          {message ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p> : null}

          <div className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
            {columns.map((col) => (
              <div key={col.key} className="flex flex-col gap-1.5">
                {col.type === "boolean" ? (
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Checkbox
                      checked={Boolean(values[col.key])}
                      onCheckedChange={(checked) => setValues((v) => ({ ...v, [col.key]: checked === true }))}
                    />
                    {col.label}
                    {col.required ? <span className="text-destructive">*</span> : null}
                  </label>
                ) : (
                  <>
                    <Label htmlFor={`row-${col.key}`}>
                      {col.label}
                      {col.required ? <span className="text-destructive"> *</span> : null}
                    </Label>
                    <Input
                      id={`row-${col.key}`}
                      type={col.type === "date" ? "date" : col.type === "datetime" ? "datetime-local" : col.type === "number" || col.type === "integer" ? "number" : "text"}
                      step={col.type === "integer" ? 1 : col.type === "number" ? "any" : undefined}
                      value={typeof values[col.key] === "string" ? (values[col.key] as string) : ""}
                      onChange={(e) => setValues((v) => ({ ...v, [col.key]: e.target.value }))}
                      required={col.required}
                    />
                  </>
                )}
              </div>
            ))}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {pending ? "Saving…" : row ? "Save changes" : "Add row"}
            </Button>
          </DialogFooter>
      </form>
    </DialogContent>
  );
}
