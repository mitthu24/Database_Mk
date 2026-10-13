import ExcelJS from "exceljs";
import Papa from "papaparse";

import type { DataLimits } from "@/lib/data/limits";
import { inspectZip, ZipGuardError } from "@/lib/import/zip-guard";

export type FileFormat = "csv" | "xlsx" | "json";

/** A spreadsheet error value such as #DIV/0!; surfaced as a row error, never silently dropped. */
export class CellError {
  constructor(public readonly code: string) {}
}
export type RawCell = string | number | boolean | Date | CellError | null | undefined | object;

export interface ParsedFile {
  format: FileFormat;
  sheetNames: string[];
  sheet?: string;
  headers: string[];
  /** Each row has exactly headers.length cells. */
  rows: RawCell[][];
  /** Problems found while parsing (malformed CSV rows etc.) keyed by 1-based data row number. */
  rowProblems: Map<number, string>;
  warnings: string[];
}

export type ImportFileErrorCode =
  | "empty"
  | "too_large"
  | "unsupported"
  | "mismatch"
  | "malformed"
  | "too_many_rows"
  | "too_many_columns"
  | "no_header";

export class ImportFileError extends Error {
  constructor(
    public readonly code: ImportFileErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImportFileError";
  }
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0];

function startsWith(bytes: Uint8Array, magic: number[]) {
  return magic.every((b, i) => bytes[i] === b);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function detectFormat(name: string, bytes: Uint8Array): FileFormat {
  const ext = extensionOf(name);
  const isZip = startsWith(bytes, ZIP_MAGIC);

  if (startsWith(bytes, OLE_MAGIC)) {
    throw new ImportFileError("unsupported", "Legacy .xls files are not supported. Save the workbook as .xlsx and try again.");
  }
  if (ext === "xlsx") {
    if (!isZip) throw new ImportFileError("mismatch", "The file is named .xlsx but is not an Excel workbook.");
    return "xlsx";
  }
  if (isZip) {
    throw new ImportFileError("mismatch", `The file is named .${ext || "?"} but its content is a compressed archive.`);
  }
  if (ext === "json") return "json";
  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    if (bytes.subarray(0, 4096).includes(0)) {
      throw new ImportFileError("mismatch", "The file contains binary data and is not a text CSV.");
    }
    return "csv";
  }
  throw new ImportFileError("unsupported", "Unsupported file type. Upload a .csv, .xlsx or .json file.");
}

function decodeText(bytes: Uint8Array, warnings: string[]): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
    warnings.push("The file is not valid UTF-8, so it was read as Windows-1252. Check accented characters.");
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function fillHeaders(raw: unknown[]): string[] {
  return raw.map((h, i) => {
    const s = h === null || h === undefined ? "" : String(h).trim();
    return s === "" ? `Column ${i + 1}` : s;
  });
}

function isBlankRow(cells: unknown[]): boolean {
  return cells.every((c) => c === null || c === undefined || (typeof c === "string" && c.trim() === ""));
}

function parseCsv(bytes: Uint8Array, limits: DataLimits): ParsedFile {
  const warnings: string[] = [];
  const text = decodeText(bytes, warnings);

  const result = Papa.parse<string[]>(text, {
    delimiter: "",
    delimitersToGuess: [",", ";", "\t", "|"],
    skipEmptyLines: "greedy",
    header: false,
    dynamicTyping: false,
    preview: limits.maxImportRows + 2,
  });

  const quoteProblem = result.errors.find((e) => e.type === "Quotes");
  if (quoteProblem) {
    throw new ImportFileError("malformed", `The CSV has an unbalanced quote near line ${(quoteProblem.row ?? 0) + 1}.`);
  }

  const table = result.data as string[][];
  if (table.length === 0) throw new ImportFileError("empty", "The file is empty.");

  const headers = fillHeaders(table[0]);
  if (headers.length > limits.maxColumns) {
    throw new ImportFileError("too_many_columns", `The file has more than ${limits.maxColumns} columns.`);
  }
  const body = table.slice(1);
  if (body.length > limits.maxImportRows) {
    throw new ImportFileError("too_many_rows", `The file has more than ${limits.maxImportRows.toLocaleString("en-US")} data rows.`);
  }

  const rowProblems = new Map<number, string>();
  const rows: RawCell[][] = body.map((cells, i) => {
    const n = i + 1;
    let row = cells as RawCell[];
    if (row.length > headers.length) {
      const extra = row.slice(headers.length);
      if (extra.every((c) => c === "" || c === undefined)) row = row.slice(0, headers.length);
      else rowProblems.set(n, `has ${row.length} fields but the header has ${headers.length}`);
    } else if (row.length < headers.length) {
      rowProblems.set(n, `has ${row.length} fields but the header has ${headers.length}`);
    }
    return headers.map((_, c) => row[c] ?? null);
  });

  return { format: "csv", sheetNames: [], headers, rows, rowProblems, warnings };
}

function parseJson(bytes: Uint8Array, limits: DataLimits): ParsedFile {
  const warnings: string[] = [];
  let value: unknown;
  try {
    value = JSON.parse(decodeText(bytes, warnings));
  } catch {
    throw new ImportFileError("malformed", "The file is not valid JSON.");
  }
  if (!Array.isArray(value)) {
    throw new ImportFileError("malformed", "JSON files must contain an array of objects, e.g. [{...}, {...}].");
  }
  if (value.length === 0) throw new ImportFileError("empty", "The file contains no records.");
  if (value.length > limits.maxImportRows) {
    throw new ImportFileError("too_many_rows", `The file has more than ${limits.maxImportRows.toLocaleString("en-US")} records.`);
  }

  const headers: string[] = [];
  const seen = new Set<string>();
  const rowProblems = new Map<number, string>();
  value.forEach((item, i) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      rowProblems.set(i + 1, "is not an object");
      return;
    }
    for (const k of Object.keys(item)) {
      if (!seen.has(k)) {
        seen.add(k);
        headers.push(k);
      }
    }
  });
  if (headers.length === 0) throw new ImportFileError("no_header", "The records have no fields.");
  if (headers.length > limits.maxColumns) {
    throw new ImportFileError("too_many_columns", `The records have more than ${limits.maxColumns} distinct fields.`);
  }

  const rows: RawCell[][] = value.map((item) => {
    const obj = typeof item === "object" && item !== null && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    return headers.map((h) => (obj[h] ?? null) as RawCell);
  });
  return { format: "json", sheetNames: [], headers, rows, rowProblems, warnings };
}

function xlsxCell(v: ExcelJS.CellValue): RawCell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v instanceof Date) return v;
  if (typeof v === "object") {
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    if ("error" in v) return new CellError(String(v.error));
    // Formulas are NEVER evaluated: only the value Excel cached is read.
    if ("formula" in v || "sharedFormula" in v) {
      const result = (v as { result?: ExcelJS.CellValue }).result;
      return result === undefined ? null : xlsxCell(result);
    }
    if ("hyperlink" in v) return xlsxCell((v as { text?: ExcelJS.CellValue }).text ?? null);
  }
  return String(v);
}

async function parseXlsx(bytes: Uint8Array, limits: DataLimits, sheetWanted?: string): Promise<ParsedFile> {
  try {
    inspectZip(bytes, { maxEntries: limits.maxZipEntries, maxUncompressedBytes: limits.maxZipUncompressedBytes });
  } catch (e) {
    if (e instanceof ZipGuardError) {
      throw new ImportFileError(e.reason === "malformed" ? "malformed" : "too_large", e.message);
    }
    throw e;
  }

  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) as unknown as ExcelJS.Buffer);
  } catch {
    throw new ImportFileError("malformed", "The workbook could not be read. It may be corrupted or password-protected.");
  }

  const sheets = wb.worksheets.filter((w) => w.state !== "hidden" && w.state !== "veryHidden");
  if (sheets.length === 0) throw new ImportFileError("empty", "The workbook has no visible sheets.");
  const ws = (sheetWanted ? sheets.find((s) => s.name === sheetWanted) : sheets[0]) ?? sheets[0];

  if (ws.actualColumnCount > limits.maxColumns) {
    throw new ImportFileError("too_many_columns", `The sheet has more than ${limits.maxColumns} columns.`);
  }
  if (ws.actualRowCount > limits.maxImportRows + 1) {
    throw new ImportFileError("too_many_rows", `The sheet has more than ${limits.maxImportRows.toLocaleString("en-US")} data rows.`);
  }

  const grid: RawCell[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    grid.push(values.slice(1).map(xlsxCell));
  });
  if (grid.length === 0) throw new ImportFileError("empty", "The sheet is empty.");

  const width = Math.max(...grid.map((r) => r.length));
  const headers = fillHeaders(Array.from({ length: width }, (_, i) => grid[0][i]));
  const rows: RawCell[][] = grid.slice(1).map((r) => headers.map((_, i) => r[i] ?? null));

  return {
    format: "xlsx",
    sheetNames: sheets.map((s) => s.name),
    sheet: ws.name,
    headers,
    rows,
    rowProblems: new Map(),
    warnings: [],
  };
}

export async function parseUpload(
  file: { name: string; bytes: Uint8Array },
  limits: DataLimits,
  options: { sheet?: string } = {},
): Promise<ParsedFile> {
  if (file.bytes.length === 0) throw new ImportFileError("empty", "The file is empty.");
  if (file.bytes.length > limits.maxFileBytes) {
    throw new ImportFileError("too_large", `The file is larger than ${Math.floor(limits.maxFileBytes / 1024 / 1024)} MB.`);
  }

  const format = detectFormat(file.name, file.bytes);
  const parsed =
    format === "csv" ? parseCsv(file.bytes, limits) : format === "json" ? parseJson(file.bytes, limits) : await parseXlsx(file.bytes, limits, options.sheet);

  // Drop trailing blank rows (spreadsheets and editors love to leave them), keep row numbering stable otherwise.
  while (parsed.rows.length > 0 && isBlankRow(parsed.rows[parsed.rows.length - 1])) parsed.rows.pop();
  if (parsed.rows.length === 0) throw new ImportFileError("empty", "The file has a header but no data rows.");
  return parsed;
}
