import { normalizeName } from "@/lib/data/columns";
import type { DataLimits } from "@/lib/data/limits";
import { rowError } from "@/lib/data/row-validation";
import type { ColumnDef, RowData } from "@/lib/data/types";
import { coerceCell } from "@/lib/import/coerce";
import type { ParsedFile } from "@/lib/import/parse";

/** column key -> index of the file column that feeds it (null = leave empty) */
export type ColumnMapping = Record<string, number | null>;

export interface PipelineIssue {
  /** 1-based data row (0 = applies to the whole file or mapping). */
  row: number;
  severity: "error" | "warning";
  message: string;
}

export interface PipelineOptions {
  columns: ColumnDef[];
  mapping?: ColumnMapping;
  /** reject: any invalid row blocks the import. skip: invalid rows are left out (and counted). */
  onError: "reject" | "skip";
  /** Leave out rows that are exact copies of an earlier row in the same file. */
  skipDuplicates: boolean;
  limits: DataLimits;
}

export interface PipelineResult {
  headers: string[];
  mapping: ColumnMapping;
  unmappedHeaders: string[];
  missingRequired: string[];
  totalRows: number;
  acceptedRows: number;
  errorRows: number;
  duplicateRows: number;
  skippedRows: number;
  issueCount: number;
  issues: PipelineIssue[];
  sample: { row: number; data: RowData }[];
  canImport: boolean;
  blockedReason: string | null;
  /** The rows to send to the database, keyed by column key. Empty unless canImport. */
  rows: RowData[];
}

/** Suggest which file column feeds each table column, matching names loosely. */
export function autoMap(headers: string[], columns: ColumnDef[]): ColumnMapping {
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  const norm = headers.map(normalizeName);

  for (const col of columns) {
    const wanted = [normalizeName(col.label), normalizeName(col.key)];
    const idx = norm.findIndex((h, i) => !used.has(i) && h !== "" && wanted.includes(h));
    if (idx >= 0) {
      used.add(idx);
      mapping[col.key] = idx;
    } else {
      mapping[col.key] = null;
    }
  }
  return mapping;
}

function canonical(row: RowData, columns: ColumnDef[]): string {
  return JSON.stringify(columns.map((c) => row[c.key] ?? null));
}

export function runPipeline(parsed: ParsedFile, opts: PipelineOptions): PipelineResult {
  const { columns, limits } = opts;
  const mapping: ColumnMapping = { ...autoMap(parsed.headers, columns), ...(opts.mapping ?? {}) };
  const issues: PipelineIssue[] = [];
  let issueCount = 0;
  const note = (issue: PipelineIssue) => {
    issueCount++;
    if (issues.length < limits.maxIssuesShown) issues.push(issue);
  };

  // A mapping must point at real file columns and use each file column once.
  const seenIdx = new Map<number, string>();
  for (const col of columns) {
    const idx = mapping[col.key];
    if (idx === null || idx === undefined) continue;
    if (!Number.isInteger(idx) || idx < 0 || idx >= parsed.headers.length) {
      mapping[col.key] = null;
      note({ row: 0, severity: "error", message: `"${col.label}" is mapped to a file column that does not exist` });
    } else if (seenIdx.has(idx)) {
      note({ row: 0, severity: "error", message: `File column "${parsed.headers[idx]}" is mapped to both "${seenIdx.get(idx)}" and "${col.label}"` });
    } else {
      seenIdx.set(idx, col.label);
    }
  }

  const missingRequired = columns.filter((c) => c.required && (mapping[c.key] ?? null) === null).map((c) => c.label);
  if (missingRequired.length > 0) {
    note({ row: 0, severity: "error", message: `Required column${missingRequired.length > 1 ? "s" : ""} not mapped: ${missingRequired.join(", ")}` });
  }
  const mappedIdx = new Set([...seenIdx.keys()]);
  const unmappedHeaders = parsed.headers.filter((_, i) => !mappedIdx.has(i));

  const accepted: { row: number; data: RowData }[] = [];
  const firstSeen = new Map<string, number>();
  let errorRows = 0;
  let duplicateRows = 0;
  let skippedRows = 0;

  parsed.rows.forEach((cells, i) => {
    const n = i + 1;
    const problem = parsed.rowProblems.get(n);
    if (problem) {
      errorRows++;
      note({ row: n, severity: "error", message: `Row ${problem}` });
      return;
    }

    const data: RowData = {};
    let bad = false;
    for (const col of columns) {
      const idx = mapping[col.key];
      if (idx === null || idx === undefined) continue;
      const res = coerceCell(cells[idx], col);
      if (!res.ok) {
        bad = true;
        note({ row: n, severity: "error", message: `${col.label}: ${res.message}` });
        break;
      }
      if (res.value !== null) data[col.key] = res.value;
    }
    if (!bad) {
      const err = rowError(columns, data);
      if (err) {
        bad = true;
        note({ row: n, severity: "error", message: err });
      }
    }
    if (bad) {
      errorRows++;
      return;
    }

    const sig = canonical(data, columns);
    const first = firstSeen.get(sig);
    if (first !== undefined) {
      duplicateRows++;
      note({ row: n, severity: "warning", message: `Duplicate of row ${first}${opts.skipDuplicates ? " (skipped)" : ""}` });
      if (opts.skipDuplicates) return;
    } else {
      firstSeen.set(sig, n);
    }
    accepted.push({ row: n, data });
  });

  const wholeFileProblems = issues.some((x) => x.row === 0 && x.severity === "error");
  let canImport = true;
  let blockedReason: string | null = null;
  if (wholeFileProblems) {
    canImport = false;
    blockedReason = "Fix the column mapping first.";
  } else if (errorRows > 0 && opts.onError === "reject") {
    canImport = false;
    blockedReason = `${errorRows.toLocaleString("en-US")} row${errorRows === 1 ? " has" : "s have"} errors. Fix the file, or choose to skip invalid rows.`;
  } else if (accepted.length === 0) {
    canImport = false;
    blockedReason = "There are no valid rows to import.";
  } else if (accepted.length > limits.maxImportRows) {
    canImport = false;
    blockedReason = `Too many rows (maximum ${limits.maxImportRows.toLocaleString("en-US")} per import).`;
  }
  if (opts.onError === "skip") skippedRows = errorRows;
  if (opts.skipDuplicates) skippedRows += duplicateRows;

  return {
    headers: parsed.headers,
    mapping,
    unmappedHeaders,
    missingRequired,
    totalRows: parsed.rows.length,
    acceptedRows: accepted.length,
    errorRows,
    duplicateRows,
    skippedRows,
    issueCount,
    issues,
    sample: accepted.slice(0, limits.previewRows),
    canImport,
    blockedReason,
    rows: canImport ? accepted.map((a) => a.data) : [],
  };
}
