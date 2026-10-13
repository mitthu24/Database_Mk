"use client";

import { useActionState, useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renameTable } from "@/lib/tables/actions";

export function RenameTableDialog({
  open,
  onOpenChange,
  tableId,
  currentName,
  onRenamed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableId: string;
  currentName: string;
  onRenamed: (name: string) => void;
}) {
  const [state, action, pending] = useActionState(renameTable, undefined);
  const submittedName = useRef(currentName);

  useEffect(() => {
    if (state?.ok) {
      toast.success("Table renamed.");
      onRenamed(submittedName.current);
      onOpenChange(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form
          action={(formData) => {
            submittedName.current = String(formData.get("name") ?? currentName);
            action(formData);
          }}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>Rename table</DialogTitle>
          </DialogHeader>
          <FormMessage message={state?.message} />
          <input type="hidden" name="tableId" value={tableId} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rename-table-name">Table name</Label>
            <Input id="rename-table-name" name="name" required maxLength={120} defaultValue={currentName} />
            {state?.fieldErrors?.name ? <p className="text-xs text-destructive">{state.fieldErrors.name[0]}</p> : null}
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {pending ? "Saving…" : "Rename"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
