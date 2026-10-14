import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ImportJob } from "@/lib/data/types";

export function ImportHistory({ jobs }: { jobs: ImportJob[] }) {
  if (jobs.length === 0) {
    return <p className="text-sm text-muted-foreground">No imports yet for this table.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>File</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Rows</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {jobs.map((job) => (
            <TableRow key={job.id}>
              <TableCell>{new Date(job.createdAt).toLocaleString()}</TableCell>
              <TableCell>{job.fileName ?? "—"}</TableCell>
              <TableCell className="capitalize">{job.mode}</TableCell>
              <TableCell>
                <Badge variant={job.status === "succeeded" ? "accent" : "destructive"}>{job.status}</Badge>
              </TableCell>
              <TableCell>
                {job.status === "succeeded"
                  ? `+${job.rowsInserted.toLocaleString()}${job.rowsDeleted ? ` / -${job.rowsDeleted.toLocaleString()}` : ""}`
                  : `${job.errorCount.toLocaleString()} error${job.errorCount === 1 ? "" : "s"}`}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
