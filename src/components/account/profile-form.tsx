"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { updateMyProfile } from "@/lib/company/actions";

export function ProfileForm({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState(updateMyProfile, undefined);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage ok={state?.ok} message={state?.message} />
      <Field name="fullName" label="Your name" autoComplete="name" required defaultValue={defaultName} errors={state?.fieldErrors?.fullName} />
      <Button type="submit" disabled={pending} className="h-10 self-start">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? "Saving…" : "Save name"}
      </Button>
    </form>
  );
}
