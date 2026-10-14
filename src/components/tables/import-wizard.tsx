"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ColumnDef } from "@/lib/data/types";

type PreviewResult = {
  headers: string[];
  mapping: Record<string, number | null>;
  unmappedHeaders: string[];
  missingRequired: string[];
  totalRows: number;
  acceptedRows: number;
  errorRows: number;
  duplicateRows: number;
  skippedRows: number;
  issueCount: number;
  issues: { row: number; severity: "error" | "warning"; message: string }[];
  sample: { row: number; data: Record<string, unknown> }[];
  canImport: boolean;
  blockedReason: string | null;
};

type ImportOutcome = { ok: true; inserted: number; deleted: number } | { ok: false; errorCount: number };

const NONE = "__none__";

export function ImportWizard({ tableId, columns, canReplace }: { tableId: string; columns: ColumnDef[]; canReplace: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"append" | "replace">("append");
  const [onError, setOnError] = useState<"reject" | "skip">("reject");
  const [skipDuplicates, setSkipDuplicates] = useState(false);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function buildFormData(): FormData {
    const fd = new FormData();
    if (file) fd.set("file", file);
    fd.set("onError", onError);
    fd.set("skipDuplicates", String(skipDuplicates));
    fd.set("mode", mode);
    if (preview) fd.set("mapping", JSON.stringify(mapping));
    return fd;
  }

  async function runPreview() {
    if (!file) return;
    setBusy("preview");
    setMessage(null);
    try {
      const res = await fetch(`/api/tables/${tableId}/import/preview`, { method: "POST", body: buildFormData() });
      const body = (await res.json()) as PreviewResult | { message: string };
      if (!res.ok) {
        setMessage("message" in body ? body.message : "Could not read that file.");
        setPreview(null);
        return;
      }
      const result = body as PreviewResult;
      setPreview(result);
      setMapping(result.mapping);
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function runCommit() {
    if (!file || !preview) return;
    setBusy("commit");
    setMessage(null);
    try {
      const res = await fetch(`/api/tables/${tableId}/import/commit`, { method: "POST", body: buildFormData() });
      const body = (await res.json()) as ImportOutcome | { message: string };
      if (!res.ok || !("ok" in body) || !body.ok) {
        setMessage("message" in body ? body.message : "The import could not be completed.");
        return;
      }
      toast.success(`Imported ${body.inserted.toLocaleString()} ${body.inserted === 1 ? "row" : "rows"}.`);
      router.push(`/tables/${tableId}`);
    } catch {
      setMessage("Could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  function updateMapping(colKey: string, value: string) {
    setMapping((m) => ({ ...m, [colKey]: value === NONE ? null : Number(value) }));
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          File (CSV, XLSX or JSON)
          <input
            type="file"
            accept=".csv,.xlsx,.json"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setMessage(null);
            }}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-secondary file:px-2 file:py-1"
          />
        </label>
        <Button onClick={runPreview} disabled={!file || busy === "preview"} className="self-start">
          {busy === "preview" ? <Loader2 className="animate-spin" aria-hidden /> : <Upload aria-hidden />}
          {busy === "preview" ? "Reading…" : "Preview"}
        </Button>
      </div>

      {message ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {message}
        </p>
      ) : null}

      {preview ? (
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Stat label="Rows in file" value={preview.totalRows} />
            <Stat label="Will import" value={preview.acceptedRows} tone="ok" />
            <Stat label="Errors" value={preview.errorRows} tone={preview.errorRows ? "bad" : undefined} />
            <Stat label="Duplicates" value={preview.duplicateRows} tone={preview.duplicateRows ? "warn" : undefined} />
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Column mapping</p>
            <div className="flex flex-col gap-1.5">
              {columns.map((col) => (
                <div key={col.key} className="flex items-center gap-2 text-sm">
                  <span className="w-40 shrink-0 truncate" title={col.label}>
                    {col.label}
                    {col.required ? <span className="text-destructive"> *</span> : null}
                  </span>
                  <Select value={mapping[col.key] === null || mapping[col.key] === undefined ? NONE : String(mapping[col.key])} onValueChange={(v) => updateMapping(col.key, v)}>
                    <SelectTrigger size="sm" className="w-56" aria-label={`File column for ${col.label}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>— leave empty —</SelectItem>
                      {preview.headers.map((h, i) => (
                        <SelectItem key={i} value={String(i)}>
                          {h || `Column ${i + 1}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            {preview.missingRequired.length > 0 ? (
              <p className="text-xs text-destructive">Required and not mapped: {preview.missingRequired.join(", ")}</p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox checked={onError === "skip"} onCheckedChange={(c) => setOnError(c ? "skip" : "reject")} />
              Skip invalid rows instead of blocking the import
            </label>
            <label className="flex items-center gap-2">
              <Checkbox checked={skipDuplicates} onCheckedChange={(c) => setSkipDuplicates(c === true)} />
              Skip duplicate rows
            </label>
            {canReplace ? (
              <label className="flex items-center gap-2">
                <Checkbox checked={mode === "replace"} onCheckedChange={(c) => setMode(c ? "replace" : "append")} />
                Replace all existing rows (instead of adding to them)
              </label>
            ) : null}
          </div>

          {preview.issues.length > 0 ? (
            <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/30 p-2 text-xs">
              {preview.issues.map((issue, i) => (
                <p key={i} className={issue.severity === "error" ? "text-destructive" : "text-muted-foreground"}>
                  {issue.row > 0 ? `Row ${issue.row}: ` : ""}
                  {issue.message}
                </p>
              ))}
              {preview.issueCount > preview.issues.length ? (
                <p className="text-muted-foreground">…and {preview.issueCount - preview.issues.length} more.</p>
              ) : null}
            </div>
          ) : null}

          {preview.sample.length > 0 ? (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((c) => (
                      <TableHead key={c.key}>{c.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.sample.slice(0, 10).map((s, i) => (
                    <TableRow key={i}>
                      {columns.map((c) => (
                        <TableCell key={c.key}>{s.data[c.key] === null || s.data[c.key] === undefined ? "—" : String(s.data[c.key])}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          <div className="flex items-center gap-3">
            {preview.canImport ? (
              <Button onClick={runCommit} disabled={busy === "commit"} variant="accent">
                {busy === "commit" ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCircle2 aria-hidden />}
                {busy === "commit" ? "Importing…" : mode === "replace" ? "Replace data" : "Import rows"}
              </Button>
            ) : (
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="size-4" aria-hidden /> {preview.blockedReason}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "bad" }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={tone === "ok" ? "text-lg font-semibold text-accent" : tone === "bad" ? "text-lg font-semibold text-destructive" : tone === "warn" ? "text-lg font-semibold text-amber-600" : "text-lg font-semibold"}>
        {value.toLocaleString()}
      </p>
    </div>
  );
}
