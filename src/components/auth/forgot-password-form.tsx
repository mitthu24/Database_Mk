"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { requestPasswordReset } from "@/lib/auth/actions";

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);

  if (state?.ok) {
    return <FormMessage ok message={state.message} />;
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage message={state?.message} />
      <Field name="email" label="Email" type="email" autoComplete="email" inputMode="email" required errors={state?.fieldErrors?.email} />
      <Button type="submit" disabled={pending} className="h-10">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
