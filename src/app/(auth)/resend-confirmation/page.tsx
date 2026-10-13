import Link from "next/link";

import { ResendConfirmationForm } from "@/components/auth/resend-confirmation-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Resend confirmation email" };

export default function ResendConfirmationPage() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Resend confirmation email</CardTitle>
        <CardDescription>Didn&apos;t get the link, or did it expire? Request a new one.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pb-6">
        <ResendConfirmationForm />
        <p className="text-sm text-muted-foreground">
          <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
            Back to sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
