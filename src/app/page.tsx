import Link from "next/link";
import { Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Table2 aria-hidden />
      </span>
      <h1 className="text-3xl font-semibold tracking-tight">Tabular Data Management</h1>
      <p className="text-muted-foreground">
        Keep your business data in secure, spreadsheet-style tables, with separate access for
        your team.
      </p>
      <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
        <Button asChild variant="accent" size="lg">
          <Link href="/register">Start 30-day free trial</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </main>
  );
}
