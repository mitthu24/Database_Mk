import Link from "next/link";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Reset your password</CardTitle>
        <CardDescription>Enter your email address and we will send you a link to choose a new password.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pb-6">
        <ForgotPasswordForm />
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
