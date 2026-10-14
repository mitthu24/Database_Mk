import Link from "next/link";
import { CheckCircle2, LayoutGrid, ShieldCheck, Table2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Tabular Data Management — Spreadsheet-style business data, properly secured",
  description:
    "Keep your business data in secure, spreadsheet-style tables, with real per-employee access control, import/export and a 30-day free trial.",
  openGraph: {
    title: "Tabular Data Management",
    description: "Spreadsheet-style business data, with real access control for your team.",
    type: "website",
  },
};

const HIGHLIGHTS = [
  {
    icon: Table2,
    title: "Spreadsheet-style tables",
    body: "Create tables with typed columns, add and edit rows, sort, filter and search — no database skills needed.",
  },
  {
    icon: ShieldCheck,
    title: "Real per-employee permissions",
    body: "Grant each employee exactly the view, create, edit, delete, import or export access they need, table by table.",
  },
  {
    icon: Upload,
    title: "Import and export",
    body: "Bring in CSV, XLSX or JSON with a preview and validation step, and export any table back out the same way.",
  },
  {
    icon: LayoutGrid,
    title: "One place for your company",
    body: "A single workspace for every table your business relies on, with an audit trail of who changed what.",
  },
];

export default function Home() {
  return (
    <>
      <section className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 py-20 text-center">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
          <Table2 className="size-7" aria-hidden />
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
          Your business data, in spreadsheet-style tables you actually control
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Create tables for orders, inventory, vendors or anything else your team tracks, give each employee exactly
          the access they need, and import or export whenever you like.
        </p>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button asChild variant="accent" size="lg">
            <Link href="/register">Start 30-day free trial</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/login">Sign in</Link>
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">No credit card required to start your trial.</p>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-12">
        <div className="grid gap-4 sm:grid-cols-2">
          {HIGHLIGHTS.map((h) => (
            <Card key={h.title}>
              <CardHeader className="flex-row items-start gap-3 space-y-0">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <h.icon className="size-5" aria-hidden />
                </span>
                <div>
                  <CardTitle className="text-base">{h.title}</CardTitle>
                  <CardDescription className="mt-1">{h.body}</CardDescription>
                </div>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-12 text-center">
        <h2 className="text-2xl font-semibold">Built for how small and medium businesses actually work</h2>
        <p className="mt-3 text-muted-foreground">
          No rigid templates. Create the tables your business needs, shape the columns the way your team already
          thinks about the data, and bring in what you already have from spreadsheets.
        </p>
        <ul className="mx-auto mt-6 flex max-w-md flex-col gap-2 text-left text-sm">
          {[
            "Admins manage the company; employees get exactly the access you grant",
            "A 30-day free trial, read-only access if it lapses — never a sudden data loss",
            "An audit log so you always know who changed what",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
        <Button asChild variant="accent" size="lg" className="mt-8">
          <Link href="/register">Start your free trial</Link>
        </Button>
      </section>
    </>
  );
}
