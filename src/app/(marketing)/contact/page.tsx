import Link from "next/link";
import { Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Contact — Tabular Data Management",
  description: "Get in touch before or after you start your trial.",
};

// Placeholder contact address — replace with the business's real support
// address before this site is deployed to production. Signed-in customers
// also see a support email configured by the founder on their billing page.
const CONTACT_EMAIL = "hello@yourcompany.example";

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Contact us</h1>
      <p className="mt-3 text-muted-foreground">
        Have a question before you start a trial, or need help with pricing for your team? Reach out and we will get
        back to you.
      </p>

      <Card className="mt-10 text-left">
        <CardHeader>
          <CardTitle className="text-base">Email</CardTitle>
          <CardDescription>For sales, pricing or general questions.</CardDescription>
        </CardHeader>
        <CardContent className="pb-6">
          <Button asChild variant="outline">
            <a href={`mailto:${CONTACT_EMAIL}`}>
              <Mail aria-hidden /> {CONTACT_EMAIL}
            </a>
          </Button>
        </CardContent>
      </Card>

      <p className="mt-8 text-sm text-muted-foreground">
        Already a customer? Your company admin can see your support contact on the{" "}
        <Link href="/login" className="underline underline-offset-4">
          billing page
        </Link>{" "}
        after signing in.
      </p>
    </div>
  );
}
