"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { submitPayment } from "@/lib/billing/actions";

export function SubmitPaymentForm() {
  const [state, action, pending] = useActionState(submitPayment, undefined);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage ok={state?.ok} message={state?.message} />
      <div className="grid grid-cols-2 gap-4">
        <Field name="amount" label="Amount" type="number" step="0.01" min="0" required errors={state?.fieldErrors?.amount} />
        <Field name="currency" label="Currency" defaultValue="USD" maxLength={3} required errors={state?.fieldErrors?.currency} />
      </div>
      <Field name="months" label="Months to add" type="number" step="1" min="1" max="36" defaultValue="1" required errors={state?.fieldErrors?.months} />
      <Field name="method" label="How did you pay" placeholder="e.g. Bank transfer" required errors={state?.fieldErrors?.method} />
      <Field name="reference" label="Payment reference" placeholder="The reference / transaction ID" required errors={state?.fieldErrors?.reference} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="note">Note (optional)</Label>
        <Textarea id="note" name="note" maxLength={1000} rows={3} />
      </div>
      <Button type="submit" disabled={pending} className="h-10 self-start">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? "Submitting…" : "Submit payment"}
      </Button>
    </form>
  );
}
