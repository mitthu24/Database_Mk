import Link from "next/link";

import { Button } from "@/components/ui/button";

export const metadata = {
  title: "How it works — Tabular Data Management",
  description: "From sign-up to your first table, in six steps.",
};

const STEPS = [
  {
    title: "Create your account and company",
    body: "Sign up with your work email and confirm it. Your 30-day free trial starts the moment your company is created.",
  },
  {
    title: "Create your first table",
    body: "Give it a name and the columns you need — text, numbers, whole numbers, yes/no, dates or date-and-time. You can change columns later.",
  },
  {
    title: "Add data, or import it",
    body: "Add rows one at a time in the grid, or upload a CSV, XLSX or JSON file. You'll see a preview and a list of any issues before anything is saved.",
  },
  {
    title: "Invite your team",
    body: "Add employees by email. They set their own password through an invitation link — you never choose or see it.",
  },
  {
    title: "Grant exactly the access each person needs",
    body: "Per table, per employee: view, create, edit, delete, import and export. Change it whenever your team changes.",
  },
  {
    title: "Export whenever you need to",
    body: "Any table you can view, you can export as CSV, XLSX or JSON — with your current search and sort applied.",
  },
];

export default function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">How it works</h1>
      <ol className="mt-8 flex flex-col gap-8">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {i + 1}
            </span>
            <div>
              <p className="font-medium">{s.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <Button asChild variant="accent" size="lg" className="mt-10">
        <Link href="/register">Start your free trial</Link>
      </Button>
    </div>
  );
}
