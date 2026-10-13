"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { signUp } from "@/lib/auth/actions";

export function RegisterForm() {
  const [state, action, pending] = useActionState(signUp, undefined);

  if (state?.ok) {
    return <FormMessage ok message={state.message} />;
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage message={state?.message} />
      <Field
        name="fullName"
        label="Your name"
        autoComplete="name"
        required
        errors={state?.fieldErrors?.fullName}
      />
      <Field
        name="companyName"
        label="Company name"
        autoComplete="organization"
        required
        errors={state?.fieldErrors?.companyName}
      />
      <Field
        name="email"
        label="Work email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        errors={state?.fieldErrors?.email}
      />
      <Field
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        minLength={10}
        hint="At least 10 characters."
        errors={state?.fieldErrors?.password}
      />
      <Button type="submit" disabled={pending} className="h-10">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? "Creating account…" : "Start 30-day free trial"}
      </Button>
    </form>
  );
}
