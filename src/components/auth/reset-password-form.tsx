"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { resetPassword } from "@/lib/auth/actions";

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(resetPassword, undefined);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage message={state?.message} />
      <Field
        name="newPassword"
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
        errors={state?.fieldErrors?.newPassword}
      />
      <Field
        name="confirmPassword"
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        errors={state?.fieldErrors?.confirmPassword}
      />
      <Button type="submit" disabled={pending} className="h-10">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? "Saving…" : "Set new password"}
      </Button>
    </form>
  );
}
