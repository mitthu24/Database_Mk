"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Field, FormMessage } from "@/components/auth/field";
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
import { addEmployee } from "@/lib/employees/actions";

export function AddEmployeeDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(addEmployee, undefined);

  useEffect(() => {
    if (state?.ok) {
      toast.success(state.message ?? "Invitation sent.");
      // Intentional: close the dialog and refresh the list once the invite succeeds.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden /> Add employee
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={formAction} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add an employee</DialogTitle>
            <DialogDescription>
              They will get an email invitation to set their own password. You never see or choose it.
            </DialogDescription>
          </DialogHeader>
          <FormMessage message={!state?.ok ? state?.message : undefined} />
          <Field name="email" label="Work email" type="email" autoComplete="email" required errors={state?.fieldErrors?.email} />
          <Field name="fullName" label="Full name" autoComplete="name" required errors={state?.fieldErrors?.fullName} />
          <Field
            name="employeeCode"
            label="Employee code (optional)"
            placeholder="Leave blank to auto-generate"
            errors={state?.fieldErrors?.employeeCode}
          />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {pending ? "Inviting…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
