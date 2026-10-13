"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    // Client-side only; never sends error details to a server here. Real
    // error reporting (Sentry/etc.) is a later milestone.
    console.error(error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <AlertTriangle aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted-foreground">
        An unexpected error occurred. No data was changed by this. Try again, and if it keeps happening, contact
        support.
      </p>
      <Button onClick={() => retry()}>Try again</Button>
    </main>
  );
}
