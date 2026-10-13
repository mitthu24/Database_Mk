"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";

import { Field, FormMessage } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import type { CompanyProfile } from "@/lib/backend/types";
import { updateCompanyProfile } from "@/lib/company/actions";

export function CompanyProfileForm({ profile, canEdit }: { profile: CompanyProfile; canEdit: boolean }) {
  const [state, action, pending] = useActionState(updateCompanyProfile, undefined);

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <FormMessage ok={state?.ok} message={state?.message} />
      <Field name="name" label="Company name" autoComplete="organization" required defaultValue={profile.name} disabled={!canEdit} errors={state?.fieldErrors?.name} />
      <Field
        name="contactEmail"
        label="Contact email"
        type="email"
        autoComplete="email"
        defaultValue={profile.contactEmail ?? ""}
        disabled={!canEdit}
        errors={state?.fieldErrors?.contactEmail}
      />
      <Field name="phone" label="Phone" autoComplete="tel" defaultValue={profile.phone ?? ""} disabled={!canEdit} errors={state?.fieldErrors?.phone} />
      <Field name="address" label="Address" defaultValue={profile.address ?? ""} disabled={!canEdit} errors={state?.fieldErrors?.address} />
      {canEdit ? (
        <Button type="submit" disabled={pending} className="h-10 self-start">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {pending ? "Saving…" : "Save company profile"}
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Your company is read-only right now, so these fields cannot be changed.
        </p>
      )}
    </form>
  );
}
