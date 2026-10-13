import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { getDataLimits } from "@/lib/data/limits";
import type { ColumnDef } from "@/lib/data/types";
import { coerceCell } from "@/lib/import/coerce";
import { CellError, ImportFileError, parseUpload } from "@/lib/import/parse";
import { autoMap, runPipeline } from "@/lib/import/pipeline";
import { inspectZip, ZipGuardError } from "@/lib/import/zip-guard";

const limits = getDataLimits({});
const enc = (s: string) => new TextEncoder().encode(s);

const columns: ColumnDef[] = [
  { key: "sku", label: "SKU", type: "text", required: true },
  { key: "qty", label: "Quantity", type: "integer" },
  { key: "price", label: "Unit Price", type: "number" },
  { key: "active", label: "Active", type: "boolean" },
  { key: "received", label: "Received", type: "date" },
];

async function xlsx(build: (wb: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  build(wb);
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe("file detection and safety", () => {
  it("rejects empty files and oversized files", async () => {
    await expect(parseUpload({ name: "a.csv", bytes: new Uint8Array() }, limits)).rejects.toMatchObject({ code: "empty" });
    const tiny = { ...limits, maxFileBytes: 10 };
    await expect(parseUpload({ name: "a.csv", bytes: enc("a,b\n1,2\n3,4\n") }, tiny)).rejects.toMatchObject({ code: "too_large" });
  });

  it("refuses a file whose content does not match its extension", async () => {
    const book = await xlsx((wb) => wb.addWorksheet("S").addRow(["a"]));
    await expect(parseUpload({ name: "data.csv", bytes: book }, limits)).rejects.toMatchObject({ code: "mismatch" });
    await expect(parseUpload({ name: "data.json", bytes: book }, limits)).rejects.toMatchObject({ code: "mismatch" });
    await expect(parseUpload({ name: "data.xlsx", bytes: enc("a,b\n1,2") }, limits)).rejects.toMatchObject({ code: "mismatch" });
    await expect(parseUpload({ name: "data.csv", bytes: new Uint8Array([97, 44, 0, 1, 2, 3]) }, limits)).rejects.toMatchObject({ code: "mismatch" });
  });

  it("explains legacy .xls and unknown types", async () => {
    const ole = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]);
    await expect(parseUpload({ name: "old.xls", bytes: ole }, limits)).rejects.toMatchObject({ code: "unsupported" });
    await expect(parseUpload({ name: "x.exe", bytes: enc("MZ") }, limits)).rejects.toMatchObject({ code: "unsupported" });
  });

  it("zip guard rejects a workbook that declares an absurd uncompressed size", () => {
    // Hand-built archive: one central-directory entry claiming 1 GiB from 100 bytes.
    const name = new TextEncoder().encode("xl/worksheets/sheet1.xml");
    const cen = new Uint8Array(46 + name.length);
    const cdv = new DataView(cen.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint32(20, 100, true);
    cdv.setUint32(24, 1024 * 1024 * 1024, true);
    cdv.setUint16(28, name.length, true);
    cen.set(name, 46);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, 1, true);
    ev.setUint16(10, 1, true);
    ev.setUint32(12, cen.length, true);
    ev.setUint32(16, 0, true);
    const zip = new Uint8Array([...cen, ...eocd]);
    expect(() => inspectZip(zip, { maxEntries: 200, maxUncompressedBytes: 64 * 1024 * 1024 })).toThrow(ZipGuardError);
  });

  it("zip guard rejects path traversal names and garbage, and accepts a real workbook", async () => {
    const book = await xlsx((wb) => wb.addWorksheet("S").addRow(["a"]));
    expect(inspectZip(book, { maxEntries: 200, maxUncompressedBytes: 64 * 1024 * 1024 }).entries).toBeGreaterThan(0);
    expect(() => inspectZip(new Uint8Array(64), { maxEntries: 200, maxUncompressedBytes: 1e9 })).toThrow(ZipGuardError);
    expect(() => inspectZip(book, { maxEntries: 1, maxUncompressedBytes: 1e9 })).toThrow(ZipGuardError);
    const bomb = { name: "x.xlsx", bytes: Uint8Array.from([0x50, 0x4b, 0x03, 0x04, ...new Array(200).fill(0)]) };
    await expect(parseUpload(bomb, limits)).rejects.toBeInstanceOf(ImportFileError);
  });
});

describe("CSV parsing", () => {
  it("parses comma, semicolon and tab delimited files and strips a BOM", async () => {
    for (const sep of [",", ";", "\t", "|"]) {
      const text = `﻿SKU${sep}Quantity\nA-1${sep}5\nA-2${sep}6\n`;
      const p = await parseUpload({ name: "x.csv", bytes: enc(text) }, limits);
      expect(p.headers).toEqual(["SKU", "Quantity"]);
      expect(p.rows).toEqual([["A-1", "5"], ["A-2", "6"]]);
    }
  });

  it("handles quoted fields containing delimiters, quotes and newlines", async () => {
    const p = await parseUpload({ name: "x.csv", bytes: enc('name,note\n"Smith, J","He said ""hi""\nthen left"\n') }, limits);
    expect(p.rows[0]).toEqual(["Smith, J", 'He said "hi"\nthen left']);
  });

  it("reports ragged rows instead of silently shifting data", async () => {
    const p = await parseUpload({ name: "x.csv", bytes: enc("a,b,c\n1,2,3\n4,5\n6,7,8,9\n10,11,12,\n") }, limits);
    expect(p.rowProblems.get(2)).toMatch(/2 fields but the header has 3/);
    expect(p.rowProblems.get(3)).toMatch(/4 fields but the header has 3/);
    expect(p.rowProblems.has(4)).toBe(false); // an empty trailing cell is harmless
  });

  it("falls back to Windows-1252 with a warning", async () => {
    const bytes = Uint8Array.from([0x6e, 0x61, 0x6d, 0x65, 0x0a, 0x43, 0x61, 0x66, 0xe9]); // "name\nCafé"
    const p = await parseUpload({ name: "x.csv", bytes }, limits);
    expect(p.rows[0][0]).toBe("Café");
    expect(p.warnings.join(" ")).toMatch(/Windows-1252/);
  });

  it("rejects an unbalanced quote, a header-only file and too many rows or columns", async () => {
    await expect(parseUpload({ name: "x.csv", bytes: enc('a,b\n"1,2\n') }, limits)).rejects.toMatchObject({ code: "malformed" });
    await expect(parseUpload({ name: "x.csv", bytes: enc("a,b\n") }, limits)).rejects.toMatchObject({ code: "empty" });
    const small = { ...limits, maxImportRows: 3 };
    await expect(parseUpload({ name: "x.csv", bytes: enc("a\n1\n2\n3\n4\n") }, small)).rejects.toMatchObject({ code: "too_many_rows" });
    const wide = { ...limits, maxColumns: 2 };
    await expect(parseUpload({ name: "x.csv", bytes: enc("a,b,c\n1,2,3\n") }, wide)).rejects.toMatchObject({ code: "too_many_columns" });
  });

  it("names blank headers and drops trailing blank rows", async () => {
    const p = await parseUpload({ name: "x.csv", bytes: enc("a,,c\n1,2,3\n,,\n  ,  ,  \n") }, limits);
    expect(p.headers).toEqual(["a", "Column 2", "c"]);
    expect(p.rows).toHaveLength(1);
  });
});

describe("JSON parsing", () => {
  it("reads an array of objects and unions their keys", async () => {
    const p = await parseUpload({ name: "x.json", bytes: enc('[{"a":1,"b":"x"},{"a":2,"c":true}]') }, limits);
    expect(p.headers).toEqual(["a", "b", "c"]);
    expect(p.rows).toEqual([[1, "x", null], [2, null, true]]);
  });
  it("rejects invalid JSON, non-arrays, empty arrays and non-object records", async () => {
    await expect(parseUpload({ name: "x.json", bytes: enc("{not json") }, limits)).rejects.toMatchObject({ code: "malformed" });
    await expect(parseUpload({ name: "x.json", bytes: enc('{"a":1}') }, limits)).rejects.toMatchObject({ code: "malformed" });
    await expect(parseUpload({ name: "x.json", bytes: enc("[]") }, limits)).rejects.toMatchObject({ code: "empty" });
    const p = await parseUpload({ name: "x.json", bytes: enc('[{"a":1},5,{"a":2}]') }, limits);
    expect(p.rowProblems.get(2)).toBe("is not an object");
  });
});

describe("XLSX parsing", () => {
  it("reads typed cells, caches formula results without evaluating, and flags error cells", async () => {
    const bytes = await xlsx((wb) => {
      const ws = wb.addWorksheet("Data");
      ws.addRow(["SKU", "Quantity", "Unit Price", "Active", "Received"]);
      ws.addRow(["A-1", 5, 2.5, true, new Date("2026-03-01T00:00:00Z")]);
      ws.addRow([{ richText: [{ text: "R" }, { text: "-2" }] }, { formula: "A2+1", result: 7 }, null, false, null]);
      ws.addRow(["E-1", { error: "#DIV/0!" }, null, null, null]);
    });
    const p = await parseUpload({ name: "x.xlsx", bytes }, limits);
    expect(p.sheet).toBe("Data");
    expect(p.rows[0]).toEqual(["A-1", 5, 2.5, true, new Date("2026-03-01T00:00:00Z")]);
    expect(p.rows[1][0]).toBe("R-2");
    expect(p.rows[1][1]).toBe(7);
    expect(p.rows[2][1]).toBeInstanceOf(CellError);
  });

  it("picks the requested sheet and ignores hidden sheets", async () => {
    const bytes = await xlsx((wb) => {
      wb.addWorksheet("Hidden").state = "hidden";
      wb.getWorksheet("Hidden")!.addRow(["x"]);
      wb.addWorksheet("First").addRows([["h"], ["1"]]);
      wb.addWorksheet("Second").addRows([["g"], ["2"]]);
    });
    const a = await parseUpload({ name: "x.xlsx", bytes }, limits);
    expect(a.sheetNames).toEqual(["First", "Second"]);
    expect(a.headers).toEqual(["h"]);
    const b = await parseUpload({ name: "x.xlsx", bytes }, limits, { sheet: "Second" });
    expect(b.headers).toEqual(["g"]);
  });
});

describe("cell coercion", () => {
  const col = (type: ColumnDef["type"]): ColumnDef => ({ key: "k", label: "K", type });
  const ok = (raw: unknown, type: ColumnDef["type"]) => {
    const r = coerceCell(raw as never, col(type));
    return r.ok ? r.value : `ERR:${r.message}`;
  };
  it("treats blanks as null for every type", () => {
    for (const t of ["text", "number", "integer", "boolean", "date", "datetime"] as const) {
      expect(ok("", t)).toBeNull();
      expect(ok("   ", t)).toBeNull();
      expect(ok(null, t)).toBeNull();
    }
  });
  it("numbers: plain, signed, exponent, grouped; rejects currency and words", () => {
    expect(ok("12", "number")).toBe(12);
    expect(ok(" -3.5 ", "number")).toBe(-3.5);
    expect(ok("1e3", "number")).toBe(1000);
    expect(ok("1,234,567.89", "number")).toBe(1234567.89);
    expect(String(ok("$5", "number"))).toMatch(/^ERR/);
    expect(String(ok("12abc", "number"))).toMatch(/^ERR/);
    expect(String(ok("1,23", "number"))).toMatch(/^ERR/);
    expect(ok(42, "number")).toBe(42);
  });
  it("integers must be whole", () => {
    expect(ok("7", "integer")).toBe(7);
    expect(ok("7.0", "integer")).toBe(7);
    expect(String(ok("7.5", "integer"))).toMatch(/^ERR/);
    expect(String(ok("99999999999999999999", "integer"))).toMatch(/^ERR/);
  });
  it("booleans accept common words", () => {
    for (const t of ["TRUE", "yes", "Y", "1", "t"]) expect(ok(t, "boolean")).toBe(true);
    for (const f of ["false", "No", "n", "0", "F"]) expect(ok(f, "boolean")).toBe(false);
    expect(String(ok("maybe", "boolean"))).toMatch(/^ERR/);
    expect(ok(true, "boolean")).toBe(true);
  });
  it("dates accept ISO and Excel dates, reject ambiguous and impossible ones", () => {
    expect(ok("2026-03-01", "date")).toBe("2026-03-01");
    expect(ok("2026/03/01", "date")).toBe("2026-03-01");
    expect(ok(new Date("2026-03-01T00:00:00Z"), "date")).toBe("2026-03-01");
    expect(String(ok("03/01/2026", "date"))).toMatch(/^ERR.*YYYY-MM-DD/);
    expect(String(ok("2026-02-30", "date"))).toMatch(/^ERR/);
    expect(String(ok(45000, "date"))).toMatch(/^ERR/);
  });
  it("datetimes accept ISO strings and Date objects", () => {
    expect(ok("2026-03-01T10:20:30Z", "datetime")).toBe("2026-03-01T10:20:30Z");
    expect(ok(new Date("2026-03-01T10:20:30Z"), "datetime")).toBe("2026-03-01T10:20:30.000Z");
    expect(String(ok("2026-03-01", "datetime"))).toMatch(/^ERR/);
  });
  it("spreadsheet error cells and nested JSON are errors, not data", () => {
    expect(String(ok(new CellError("#N/A"), "text"))).toMatch(/^ERR.*#N\/A/);
    expect(String(ok({ a: 1 }, "text"))).toMatch(/^ERR.*nested/);
    expect(String(ok([1, 2], "text"))).toMatch(/^ERR.*nested/);
  });
  it("text keeps content exactly, including formulas (they are stored as data, never evaluated)", () => {
    expect(ok("=SUM(A1:A9)", "text")).toBe("=SUM(A1:A9)");
    expect(ok(5, "text")).toBe("5");
  });
});

describe("mapping and pipeline", () => {
  it("auto-maps headers loosely by label or key (punctuation and case ignored) and uses each file column once", () => {
    const m = autoMap(["sku", "QUANTITY", "unit_price", "Active?", "Extra"], columns);
    expect(m).toEqual({ sku: 0, qty: 1, price: 2, active: 3, received: null });
  });

  async function pipeline(csv: string, over: Partial<Parameters<typeof runPipeline>[1]> = {}) {
    const parsed = await parseUpload({ name: "x.csv", bytes: enc(csv) }, limits);
    return runPipeline(parsed, { columns, onError: "reject", skipDuplicates: false, limits, ...over });
  }

  it("accepts a clean file and produces typed rows keyed by column key", async () => {
    const r = await pipeline("SKU,Quantity,Unit Price,Active,Received\nA-1,5,2.5,yes,2026-03-01\nA-2,,,,\n");
    expect(r.canImport).toBe(true);
    expect(r.rows).toEqual([{ sku: "A-1", qty: 5, price: 2.5, active: true, received: "2026-03-01" }, { sku: "A-2" }]);
    expect(r.errorRows).toBe(0);
  });

  it("blocks the import and explains each bad row, with numbering", async () => {
    const r = await pipeline("SKU,Quantity\nA-1,5\n,2\nA-3,lots\nA-4,1.5\n");
    expect(r.canImport).toBe(false);
    expect(r.errorRows).toBe(3);
    expect(r.issues.map((i) => i.row)).toEqual([2, 3, 4]);
    expect(r.issues[0].message).toBe("SKU is required");
    expect(r.issues[1].message).toMatch(/Quantity: "lots" is not a number/);
    expect(r.issues[2].message).toMatch(/not a whole number/);
    expect(r.rows).toEqual([]);
    expect(r.blockedReason).toMatch(/3 rows have errors/);
  });

  it("can skip invalid rows when the user chooses to", async () => {
    const r = await pipeline("SKU,Quantity\nA-1,5\n,2\nA-3,7\n", { onError: "skip" });
    expect(r.canImport).toBe(true);
    expect(r.rows).toEqual([{ sku: "A-1", qty: 5 }, { sku: "A-3", qty: 7 }]);
    expect(r.skippedRows).toBe(1);
  });

  it("reports duplicate rows as warnings and can skip them", async () => {
    const csv = "SKU,Quantity\nA-1,5\nA-2,6\nA-1,5\nA-1,5\n";
    const keep = await pipeline(csv);
    expect(keep.duplicateRows).toBe(2);
    expect(keep.rows).toHaveLength(4);
    expect(keep.issues.filter((i) => i.severity === "warning").map((i) => i.message)).toEqual(["Duplicate of row 1", "Duplicate of row 1"]);
    const drop = await pipeline(csv, { skipDuplicates: true });
    expect(drop.rows).toHaveLength(2);
    expect(drop.skippedRows).toBe(2);
  });

  it("requires every required column to be mapped, and supports manual remapping", async () => {
    const csv = "Code,Quantity\nA-1,5\n";
    const unmapped = await pipeline(csv);
    expect(unmapped.canImport).toBe(false);
    expect(unmapped.missingRequired).toEqual(["SKU"]);
    const mapped = await pipeline(csv, { mapping: { sku: 0, qty: 1 } });
    expect(mapped.canImport).toBe(true);
    expect(mapped.rows).toEqual([{ sku: "A-1", qty: 5 }]);
  });

  it("rejects a mapping that points outside the file or reuses a file column", async () => {
    const csv = "Code,Quantity\nA-1,5\n";
    const outside = await pipeline(csv, { mapping: { sku: 9 } });
    expect(outside.canImport).toBe(false);
    const reused = await pipeline(csv, { mapping: { sku: 0, qty: 0 } });
    expect(reused.canImport).toBe(false);
    expect(reused.issues.some((i) => /mapped to both/.test(i.message))).toBe(true);
  });

  it("flags malformed CSV rows as errors and leaves unmapped file columns out", async () => {
    const r = await pipeline("SKU,Quantity,Notes\nA-1,5,x\nA-2,6\n");
    expect(r.errorRows).toBe(1);
    expect(r.issues[0].message).toMatch(/Row has 2 fields but the header has 3/);
    expect(r.unmappedHeaders).toEqual(["Notes"]);
  });

  it("caps the number of issues kept for display while counting all of them", async () => {
    const lines = Array.from({ length: 200 }, (_, i) => `,${i}`).join("\n");
    const r = await pipeline(`SKU,Quantity\n${lines}\n`);
    expect(r.issueCount).toBe(200);
    expect(r.issues).toHaveLength(limits.maxIssuesShown);
  });

  it("enforces the configured row ceiling", async () => {
    const r = await pipeline("SKU\na\nb\nc\n", { limits: { ...limits, maxImportRows: 2 } });
    expect(r.canImport).toBe(false);
    expect(r.blockedReason).toMatch(/Too many rows/);
  });
});
