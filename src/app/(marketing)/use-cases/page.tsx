import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Use cases for small and medium businesses — Tabular Data Management",
  description: "How manufacturers, distributors and service businesses use tables, permissions and import/export.",
};

const USE_CASES = [
  {
    title: "Manufacturing: orders, inventory and vendors",
    body: "A plywood or panel manufacturer tracks incoming orders, raw material and finished-goods inventory, and vendor contacts in separate tables. Production staff get edit access to inventory; sales sees orders; only the admin can see vendor pricing.",
  },
  {
    title: "Distribution: stock levels across locations",
    body: "A distributor keeps a stock table per warehouse, imports updated counts from a supplier's spreadsheet each week, and exports a filtered view for a specific customer or route.",
  },
  {
    title: "Services: client records and job tracking",
    body: "A services business tracks clients, jobs and invoices as separate tables, gives field staff edit access only to the job table, and keeps an audit log of who updated a job's status.",
  },
  {
    title: "Any team replacing a shared spreadsheet",
    body: "If a spreadsheet is currently emailed around or shared with no real access control, importing it into a table gives you the same columns, proper permissions per employee, and a record of changes.",
  },
];

export default function UseCasesPage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-16">
      <div className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight">Use cases</h1>
        <p className="mt-3 text-muted-foreground">
          A few examples of how small and medium businesses use the product. Your tables can look however your
          business actually works — these are starting points, not templates you&apos;re locked into.
        </p>
      </div>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {USE_CASES.map((u) => (
          <Card key={u.title}>
            <CardHeader>
              <CardTitle className="text-base">{u.title}</CardTitle>
            </CardHeader>
            <CardContent className="pb-6">
              <CardDescription>{u.body}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="mt-10">
        <Button asChild variant="accent" size="lg">
          <Link href="/register">Start your free trial</Link>
        </Button>
      </div>
    </div>
  );
}
