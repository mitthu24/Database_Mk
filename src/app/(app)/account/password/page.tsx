import { Suspense } from "react";

import { connection } from "next/server";
import { PasswordForm } from "@/components/auth/password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/dal";

export const metadata = { title: "Change password" };

async function PasswordContent() {
  await connection();
  await requireUser();

  return (
    <Card className="mx-auto max-w-md">
      <CardHeader>
        <CardTitle className="text-xl">Change password</CardTitle>
        <CardDescription>
          Confirm your current password. Your other devices will be signed out.
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-6">
        <PasswordForm />
      </CardContent>
    </Card>
  );
}

export default function PasswordPage() {
  return (
    <Suspense fallback={<div className="mx-auto h-72 max-w-md animate-pulse rounded-xl bg-muted" aria-hidden />}>
      <PasswordContent />
    </Suspense>
  );
}
