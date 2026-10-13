"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import Link from "next/link";

import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth/actions";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(signIn, undefined);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next ?? ""} />
      <FormMessage ok={state?.ok} message={state?.message} />
      <Field
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        inputMode="email"
        required
        errors={state?.fieldErrors?.email}
      />
      <div className="flex flex-col gap-1.5">
        <Field
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          errors={state?.fieldErrors?.password}
        />
        <Link href="/forgot-password" className="self-end text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Forgot your password?
        </Link>
      </div>
      <Button type="submit" disabled={pending} className="h-10">
        {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <Link href="/resend-confirmation" className="text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
        Need a new confirmation email?
      </Link>
    </form>
  );
}
