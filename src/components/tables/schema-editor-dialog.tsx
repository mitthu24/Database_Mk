"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COLUMN_TYPE_LABELS, COLUMN_TYPES, type ColumnDef, type ColumnType, type TableSummary } from "@/lib/data/types";
import { makeColumnKey } from "@/lib/data/columns";
import { updateTableSchema } from "@/lib/tables/actions";

type Row = ColumnDef;

export function SchemaEditorDialog({
  open,
  onOpenChange,
  table,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  table: TableSummary;
  onSaved: (table: TableSummary) => void;
}) {
  // The dialog unmounts its content on close (Radix default), so each open is
  // a fresh mount: lazy initial state from props needs no effect.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open ? <SchemaEditorContent table={table} onOpenChange={onOpenChange} onSaved={onSaved} /> : null}
    </Dialog>
  );
}

function SchemaEditorContent({
  table,
  onOpenChange,
  onSaved,
}: {
  table: TableSummary;
  onOpenChange: (open: boolean) => void;
  onSaved: (table: TableSummary) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() => table.columns.map((c) => ({ ...c })));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | undefined>();

  function addColumn() {
    const key = makeColumnKey("New column", rows.map((r) => r.key));
    setRows((r) => [...r, { key, label: "New column", type: "text", required: false }]);
  }

  async function save() {
    setPending(true);
    setMessage(undefined);
    const result = await updateTableSchema(table.id, rows);
    setPending(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    toast.success("Table schema updated.");
    onOpenChange(false);
    onSaved(result.table);
  }

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Edit columns</DialogTitle>
        <DialogDescription>
          Renaming a column keeps its data. Changing a column&apos;s type or removing it can fail or lose data, and the
          server will refuse a change that is not safe.
        </DialogDescription>
      </DialogHeader>

      {message ? <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{message}</p> : null}

      <div className="flex max-h-80 flex-col gap-2 overflow-y-auto pr-1">
        {rows.map((col, i) => (
          <div key={col.key} className="flex items-center gap-2">
            <Input
              value={col.label}
              onChange={(e) => setRows((r) => r.map((c, idx) => (idx === i ? { ...c, label: e.target.value } : c)))}
              maxLength={120}
              className="flex-1"
            />
            <Select value={col.type} onValueChange={(v) => setRows((r) => r.map((c, idx) => (idx === i ? { ...c, type: v as ColumnType } : c)))}>
              <SelectTrigger size="sm" className="w-36" aria-label={`Type for ${col.label || `column ${i + 1}`}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COLUMN_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {COLUMN_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Required">
              <Checkbox
                checked={Boolean(col.required)}
                onCheckedChange={(checked) => setRows((r) => r.map((c, idx) => (idx === i ? { ...c, required: checked === true } : c)))}
              />
              Required
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${col.label}`}
              disabled={rows.length === 1}
              onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
            >
              <Trash2 aria-hidden />
            </Button>
          </div>
        ))}
      </div>

      <Button type="button" variant="outline" size="sm" className="self-start" onClick={addColumn}>
        <Plus aria-hidden /> Add column
      </Button>

      <DialogFooter>
        <Button type="button" onClick={save} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {pending ? "Saving…" : "Save schema"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
