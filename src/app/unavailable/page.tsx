import { AlertTriangle } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Service unavailable" };

// Reached when the configured backend (Supabase) is unreachable at request
// time — never a blank error, and never silently treated as "signed out".
export default function UnavailablePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">The service is temporarily unavailable</h1>
      <p className="text-sm text-muted-foreground">
        We could not reach the backend just now. Nothing was lost — please try again in a moment.
      </p>
      <Button asChild variant="outline">
        <Link href="/">Try again</Link>
      </Button>
    </main>
  );
}
