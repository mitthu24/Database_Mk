import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";

import type { ColumnDef, JsonPrimitive, RowData } from "@/lib/data/types";
import { sanitizeCellText } from "@/lib/export/sanitize";

export type ExportFormat = "csv" | "xlsx" | "json";

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  json: "application/json; charset=utf-8",
};

/** Make a download filename safe for a Content-Disposition header. */
export function safeFileName(name: string, ext: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+|[._]+$/g, "")
    .slice(0, 80);
  return `${base || "export"}.${ext}`;
}

// ---- CSV ---------------------------------------------------------------------------

function csvField(s: string): string {
  return /[",\r\n]/.test(s) || s.startsWith(" ") || s.endsWith(" ") ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvValue(v: JsonPrimitive | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return csvField(sanitizeCellText(v));
  return String(v);
}

/** UTF-8 BOM so Excel reads accented characters correctly. */
export const CSV_BOM = "﻿";

export function csvHeader(columns: ColumnDef[]): string {
  return columns.map((c) => csvField(sanitizeCellText(c.label))).join(",") + "\r\n";
}

export function csvRows(columns: ColumnDef[], rows: RowData[]): string {
  return rows.map((r) => columns.map((c) => csvValue(r[c.key])).join(",") + "\r\n").join("");
}

// ---- JSON --------------------------------------------------------------------------

/** Objects keyed by column LABEL (round-trips with the importer's header matching). */
export function jsonRecord(columns: ColumnDef[], row: RowData): Record<string, JsonPrimitive> {
  const out: Record<string, JsonPrimitive> = {};
  for (const c of columns) out[c.label] = row[c.key] ?? null;
  return out;
}

// ---- XLSX --------------------------------------------------------------------------

function xlsxValue(c: ColumnDef, v: JsonPrimitive | undefined): ExcelJS.CellValue {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") {
    if (c.type === "date") return new Date(`${v}T00:00:00Z`);
    if (c.type === "datetime") {
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? sanitizeCellText(v) : d;
    }
    return sanitizeCellText(v);
  }
  return v;
}

export async function buildXlsx(
  sheetName: string,
  columns: ColumnDef[],
  pages: AsyncIterable<RowData[]>,
): Promise<Uint8Array> {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((resolve, reject) => {
    out.on("end", resolve);
    out.on("error", reject);
  });

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  // Excel sheet names: max 31 chars, none of \ / ? * [ ] :, no leading/trailing apostrophe.
  const safeSheet = sheetName.replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31).replace(/^'+|'+$/g, "").trim();
  const ws = wb.addWorksheet(safeSheet || "Data", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = columns.map((c) => ({
    header: sanitizeCellText(c.label),
    key: c.key,
    width: Math.min(Math.max(c.label.length + 4, 12), 40),
    style: c.type === "date" ? { numFmt: "yyyy-mm-dd" } : c.type === "datetime" ? { numFmt: "yyyy-mm-dd hh:mm:ss" } : {},
  }));
  ws.getRow(1).font = { bold: true };

  for await (const page of pages) {
    for (const row of page) {
      ws.addRow(columns.map((c) => xlsxValue(c, row[c.key]))).commit();
    }
  }
  ws.commit();
  await wb.commit();
  await done;
  return new Uint8Array(Buffer.concat(chunks));
}
