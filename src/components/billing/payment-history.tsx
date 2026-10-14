import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Payment } from "@/lib/backend/types";

const STATUS_VARIANT = { pending: "secondary", approved: "accent", rejected: "destructive" } as const;

export function PaymentHistory({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) {
    return <p className="text-sm text-muted-foreground">No payments submitted yet.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Submitted</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Months</TableHead>
            <TableHead>Reference</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Note</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {payments.map((p) => (
            <TableRow key={p.id}>
              <TableCell>{new Date(p.createdAt).toLocaleDateString()}</TableCell>
              <TableCell>
                {p.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })} {p.currency}
              </TableCell>
              <TableCell>{p.months}</TableCell>
              <TableCell>{p.reference}</TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[p.status]}>{p.status}</Badge>
              </TableCell>
              <TableCell className="max-w-48 truncate" title={p.reviewNote ?? undefined}>
                {p.status === "rejected" ? p.reviewNote ?? "—" : "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
