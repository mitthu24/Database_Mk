"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
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
import { createCompany } from "@/lib/founder/actions";

export function CreateCompanyDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createCompany, undefined);

  useEffect(() => {
    if (state?.ok && state.companyId) {
      // Intentional: close the dialog and navigate to the new company once creation succeeds.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(false);
      toast.success("Company created and admin invited.");
      router.push(`/founder/companies/${state.companyId}`);
    }
  }, [state, router]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden /> New company
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={action} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Provision a company</DialogTitle>
            <DialogDescription>
              Creates the company and invites its first admin by email. They set their own password.
            </DialogDescription>
          </DialogHeader>
          <FormMessage message={state && !state.ok ? state.message : undefined} />
          <Field name="companyName" label="Company name" required errors={state?.fieldErrors?.companyName} />
          <Field name="fullName" label="Admin's full name" required errors={state?.fieldErrors?.fullName} />
          <Field name="email" label="Admin's email" type="email" required errors={state?.fieldErrors?.email} />
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
              {pending ? "Creating…" : "Create company"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
