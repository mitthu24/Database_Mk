import { Download, FileSpreadsheet, History, ShieldCheck, Table2, Users } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Features — Tabular Data Management",
  description: "Tables, permissions, import/export and the audit log — what's actually in the product.",
};

const FEATURES = [
  {
    icon: Table2,
    title: "Table library and spreadsheet-style grid",
    body: "Create tables with text, number, whole-number, yes/no, date and date-and-time columns. Add required columns, resize columns, sort and search, and page through large tables without ever loading more than one page at a time.",
  },
  {
    icon: Users,
    title: "Employees and per-table permissions",
    body: "Invite employees by email — they set their own password, you never see it. Grant each one view, create, edit, delete, import and export access on a per-table basis, and change it at any time.",
  },
  {
    icon: FileSpreadsheet,
    title: "Import with a real preview",
    body: "Upload a CSV, XLSX or JSON file and see exactly which rows will import, which will not, and why, before anything is written. Add new rows or replace a table's contents entirely.",
  },
  {
    icon: Download,
    title: "Export your own data, any time",
    body: "Export any table you can view as CSV, XLSX or JSON, respecting your current search and sort. Your data is always yours to take with you.",
  },
  {
    icon: History,
    title: "Audit log",
    body: "Every table created, schema change, row import, permission change and status change is recorded, so your company always has a record of who did what.",
  },
  {
    icon: ShieldCheck,
    title: "Access that degrades safely, not suddenly",
    body: "If a trial lapses, your data goes read-only — you can still view and export it — instead of disappearing. A suspended company is the only state where data access stops.",
  },
];

export default function FeaturesPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">Features</h1>
        <p className="mt-3 text-muted-foreground">Everything below is in the product today, not on a roadmap.</p>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <Card key={f.title}>
            <CardHeader className="flex-row items-start gap-3 space-y-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                <f.icon className="size-5" aria-hidden />
              </span>
              <div>
                <CardTitle className="text-base">{f.title}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pb-6">
              <CardDescription>{f.body}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
