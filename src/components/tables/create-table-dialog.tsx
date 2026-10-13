"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { COLUMN_TYPE_LABELS, COLUMN_TYPES, type ColumnType } from "@/lib/data/types";
import { createTable } from "@/lib/tables/actions";

interface DraftColumn {
  label: string;
  type: ColumnType;
  required: boolean;
}

const emptyColumn = (): DraftColumn => ({ label: "", type: "text", required: false });

export function CreateTableDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [columns, setColumns] = useState<DraftColumn[]>([emptyColumn()]);
  const [state, formAction, pending] = useActionState(createTable, undefined);
  const [, startTransition] = useTransition();

  function update(i: number, patch: Partial<DraftColumn>) {
    setColumns((cols) => cols.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function submit(formData: FormData) {
    formData.set("columns", JSON.stringify(columns.filter((c) => c.label.trim())));
    startTransition(() => {
      formAction(formData);
    });
  }

  useEffect(() => {
    if (state?.ok && state.tableId) {
      // Intentional: close the dialog and navigate once the create action succeeds.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      toast.success("Table created.");
      router.push(`/tables/${state.tableId}`);
    }
  }, [state, router]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setColumns([emptyColumn()]);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> New table
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create a table</DialogTitle>
            <DialogDescription>Give it a name and the columns you want to start with. You can change this later.</DialogDescription>
          </DialogHeader>

          <FormMessage message={state?.message} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="table-name">Table name</Label>
            <Input id="table-name" name="name" required maxLength={120} placeholder="e.g. Orders" />
            {state?.fieldErrors?.name ? <p className="text-xs text-destructive">{state.fieldErrors.name[0]}</p> : null}
          </div>

          <div className="flex flex-col gap-2">
            <Label>Columns</Label>
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto pr-1">
              {columns.map((col, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    value={col.label}
                    onChange={(e) => update(i, { label: e.target.value })}
                    placeholder={`Column ${i + 1}`}
                    maxLength={120}
                    className="flex-1"
                  />
                  <Select value={col.type} onValueChange={(v) => update(i, { type: v as ColumnType })}>
                    <SelectTrigger size="sm" className="w-36">
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
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Remove column"
                    disabled={columns.length === 1}
                    onClick={() => setColumns((cols) => cols.filter((_, idx) => idx !== i))}
                  >
                    <Trash2 aria-hidden />
                  </Button>
                </div>
              ))}
            </div>
            <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setColumns((cols) => [...cols, emptyColumn()])}>
              <Plus aria-hidden /> Add column
            </Button>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {pending ? "Creating…" : "Create table"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
