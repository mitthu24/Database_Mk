import { Suspense } from "react";

import { connection } from "next/server";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/dal";

export const metadata = { title: "Set a new password" };

// Reached from a password-reset email link, which exchanges its code for a
// session at /auth/callback before redirecting here. No "current password" is
// asked for: the link itself proves possession of the account.
async function ResetContent() {
  await connection();
  await requireUser();

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">Set a new password</CardTitle>
        <CardDescription>Choose a new password for your account.</CardDescription>
      </CardHeader>
      <CardContent className="pb-6">
        <ResetPasswordForm />
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-56 max-w-md animate-pulse rounded-xl bg-muted" aria-hidden />}>
      <ResetContent />
    </Suspense>
  );
}
