import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import type { ColumnDef, RowData } from "@/lib/data/types";
import { getDataLimits } from "@/lib/data/limits";
import { buildXlsx, csvHeader, csvRows, CSV_BOM, jsonRecord, safeFileName } from "@/lib/export/formats";
import { sanitizeCellText } from "@/lib/export/sanitize";
import { parseUpload } from "@/lib/import/parse";
import { runPipeline } from "@/lib/import/pipeline";

const columns: ColumnDef[] = [
  { key: "name", label: "Name", type: "text", required: true },
  { key: "qty", label: "Quantity", type: "integer" },
  { key: "price", label: "Price", type: "number" },
  { key: "ok", label: "OK", type: "boolean" },
  { key: "day", label: "Day", type: "date" },
  { key: "seen", label: "Seen", type: "datetime" },
];

describe("formula-injection sanitizer", () => {
  it.each([
    ["=1+1", "'=1+1"],
    ["+SUM(A1)", "'+SUM(A1)"],
    ["-2+3", "'-2+3"],
    ["@cmd", "'@cmd"],
    ["\tTAB", "'\tTAB"],
    ["\rCR", "'\rCR"],
    ["  =HYPERLINK(\"http://evil\")", "'  =HYPERLINK(\"http://evil\")"],
    ["=cmd|' /C calc'!A0", "'=cmd|' /C calc'!A0"],
    ["normal", "normal"],
    ["", ""],
    ["a=b", "a=b"],
    ["email@example.com", "email@example.com"],
  ])("%j -> %j", (input, expected) => expect(sanitizeCellText(input)).toBe(expected));
});

describe("CSV export", () => {
  const rows: RowData[] = [
    { name: "Plain", qty: 2, price: -1.5, ok: true, day: "2026-03-01", seen: "2026-03-01T10:00:00Z" },
    { name: 'Has, comma and "quote"', qty: null, price: null, ok: false },
    { name: "=HYPERLINK(\"http://evil.test\",\"click\")", qty: -3 },
    { name: "line1\nline2" },
    { name: " padded " },
  ];

  it("writes a header, quotes correctly and never mangles real negative numbers", () => {
    const csv = csvHeader(columns) + csvRows(columns, rows);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("Name,Quantity,Price,OK,Day,Seen");
    expect(lines[1]).toBe("Plain,2,-1.5,true,2026-03-01,2026-03-01T10:00:00Z");
    expect(lines[2]).toBe('"Has, comma and ""quote""",,,false,,');
    expect(lines[3]).toContain("-3"); // numeric -3 stays a number
    expect(csv).toContain('"line1\nline2"');
    expect(csv).toContain('" padded "');
  });

  it("neutralises formulas in text cells AND in column headers", () => {
    const csv = csvRows(columns, rows);
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.test"",""click"")"`);
    const evilCols: ColumnDef[] = [{ key: "a", label: "=1+1", type: "text" }];
    expect(csvHeader(evilCols)).toBe("'=1+1\r\n");
  });

  it("exposes a BOM constant for Excel compatibility", () => {
    expect(CSV_BOM).toBe("﻿");
  });
});

describe("JSON export", () => {
  it("keys records by label and fills missing values with null", () => {
    expect(jsonRecord(columns, { name: "A", qty: 1 })).toEqual({
      Name: "A", Quantity: 1, Price: null, OK: null, Day: null, Seen: null,
    });
  });
});

describe("file names", () => {
  it("makes safe download names", () => {
    expect(safeFileName('Q3 "Sales"/2026', "csv")).toBe("Q3_Sales_2026.csv");
    expect(safeFileName("../../etc/passwd", "csv")).toBe("etc_passwd.csv");
    expect(safeFileName("", "xlsx")).toBe("export.xlsx");
    expect(safeFileName("Café", "json")).toBe("Cafe.json");
    expect(safeFileName("line\r\nbreak", "csv")).not.toMatch(/[\r\n]/);
  });
});

async function* pages(rows: RowData[], size = 2): AsyncIterable<RowData[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

describe("XLSX export", () => {
  const rows: RowData[] = [
    { name: "Plain", qty: 2, price: -1.5, ok: true, day: "2026-03-01", seen: "2026-03-01T10:00:00Z" },
    { name: "=HYPERLINK(\"http://evil.test\",\"x\")", qty: -7 },
    { name: "@SUM(1)", price: 3 },
    { name: "Third" },
  ];

  it("writes typed cells, a frozen bold header, and never a live formula", async () => {
    const bytes = await buildXlsx("Orders", columns, pages(rows));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Orders")!;
    expect(ws.getRow(1).values).toEqual([undefined, "Name", "Quantity", "Price", "OK", "Day", "Seen"]);
    expect(ws.getRow(1).font?.bold).toBe(true);
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });

    expect(ws.getCell("B2").value).toBe(2);
    expect(ws.getCell("C2").value).toBe(-1.5);
    expect(ws.getCell("D2").value).toBe(true);
    expect(ws.getCell("E2").value).toEqual(new Date("2026-03-01T00:00:00Z"));
    expect(ws.getCell("E2").numFmt).toBe("yyyy-mm-dd");
    expect(ws.getCell("B3").value).toBe(-7); // a real negative number stays numeric

    const evil = ws.getCell("A3").value;
    expect(typeof evil).toBe("string");
    expect(evil).toBe("'=HYPERLINK(\"http://evil.test\",\"x\")");
    expect(ws.getCell("A4").value).toBe("'@SUM(1)");
    for (const addr of ["A3", "A4"]) {
      expect(ws.getCell(addr).type).not.toBe(ExcelJS.ValueType.Formula);
    }
  });

  it("sanitises an unsafe sheet name and handles zero rows", async () => {
    const bytes = await buildXlsx("A/B:C?*[x]", columns, pages([]));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ExcelJS.Buffer);
    expect(wb.worksheets[0].name).toBe("A B C   x");
    const quoted = await buildXlsx("'Quoted'", columns, pages([]));
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(Buffer.from(quoted) as unknown as ExcelJS.Buffer);
    expect(wb2.worksheets[0].name).toBe("Quoted");
  });
});

describe("export -> import round trip", () => {
  it("a CSV export can be re-imported without loss for ordinary data", async () => {
    const data: RowData[] = [
      { name: "Widget", qty: 5, price: 2.5, ok: true, day: "2026-03-01", seen: "2026-03-01T10:00:00Z" },
      { name: "Gadget, large", qty: -2, price: 0, ok: false },
    ];
    const csv = csvHeader(columns) + csvRows(columns, data);
    const parsed = await parseUpload({ name: "round.csv", bytes: new TextEncoder().encode(csv) }, getDataLimits({}));
    const r = runPipeline(parsed, { columns, onError: "reject", skipDuplicates: false, limits: getDataLimits({}) });
    expect(r.canImport).toBe(true);
    expect(r.rows).toEqual(data);
  });

  it("an XLSX export can be re-imported", async () => {
    const data: RowData[] = [{ name: "Widget", qty: 5, price: 2.5, ok: true, day: "2026-03-01", seen: "2026-03-01T10:00:00.000Z" }];
    const bytes = await buildXlsx("Data", columns, pages(data));
    const parsed = await parseUpload({ name: "round.xlsx", bytes }, getDataLimits({}));
    const r = runPipeline(parsed, { columns, onError: "reject", skipDuplicates: false, limits: getDataLimits({}) });
    expect(r.canImport).toBe(true);
    expect(r.rows).toEqual(data);
  });
});
