"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { registerCompany } from "@/lib/auth/actions";

export function CompanyForm({ defaultName }: { defaultName?: string }) {
  const [state, action, pending] = useActionState(registerCompany, undefined);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage message={state?.message} />
      <Field
        name="companyName"
        label="Company name"
        autoComplete="organization"
        defaultValue={defaultName}
        required
        errors={state?.fieldErrors?.companyName}
      />
      <Button type="submit" disabled={pending} className="h-10">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? "Creating…" : "Create company and start trial"}
      </Button>
    </form>
  );
}
