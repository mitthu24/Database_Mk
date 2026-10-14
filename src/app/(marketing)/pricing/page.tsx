import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Pricing — Tabular Data Management",
  description: "Start with a 30-day free trial. Contact us for pricing suited to your company.",
};

const TRIAL_INCLUDES = [
  "Unlimited tables and rows during your trial",
  "Invite your whole team and set permissions from day one",
  "Import and export as many times as you like",
  "No credit card required to start",
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-3xl font-semibold tracking-tight">Pricing</h1>
      <p className="mt-3 text-muted-foreground">
        Every company starts with a free 30-day trial with full access. After that, your data becomes read-only — you
        can still view and export it — until you set up a plan.
      </p>

      <Card className="mt-10 text-left">
        <CardHeader>
          <CardTitle>30-day free trial</CardTitle>
          <CardDescription>No credit card required. Cancel any time before it ends with nothing owed.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pb-6">
          <ul className="flex flex-col gap-2 text-sm">
            {TRIAL_INCLUDES.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
          <Button asChild variant="accent" size="lg" className="self-start">
            <Link href="/register">Start your free trial</Link>
          </Button>
        </CardContent>
      </Card>

      <p className="mt-8 text-sm text-muted-foreground">
        After your trial, pricing is set per company based on your team size and tables.{" "}
        <Link href="/contact" className="underline underline-offset-4">
          Contact us
        </Link>{" "}
        and we will walk you through it.
      </p>
    </div>
  );
}
