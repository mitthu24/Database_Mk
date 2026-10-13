import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <FileQuestion aria-hidden />
      </span>
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted-foreground">The page you are looking for does not exist or has moved.</p>
      <Button asChild>
        <Link href="/dashboard">Go to dashboard</Link>
      </Button>
    </main>
  );
}
