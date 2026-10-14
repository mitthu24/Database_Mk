import { describe, expect, it } from "vitest";

import { getDataLimits } from "@/lib/data/limits";
import type { ColumnDef } from "@/lib/data/types";
import { parseImportRequest } from "@/lib/import/request";

const columns: ColumnDef[] = [
  { key: "sku", label: "SKU", type: "text", required: true },
  { key: "qty", label: "Quantity", type: "integer" },
];

function requestWith(fields: Record<string, string | Blob>): Request {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request("http://localhost/x", { method: "POST", body: fd });
}

function csvFile(contents: string, name = "data.csv") {
  return new File([contents], name, { type: "text/csv" });
}

describe("parseImportRequest", () => {
  it("parses, auto-maps and validates a CSV file", async () => {
    const req = requestWith({ file: csvFile("SKU,Quantity\nPLY-1,10\nPLY-2,20\n") });
    const result = await parseImportRequest(req as never, columns, getDataLimits());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.acceptedRows).toBe(2);
    expect(result.result.canImport).toBe(true);
    expect(result.mode).toBe("append");
  });

  it("rejects when no file is attached", async () => {
    const req = requestWith({ onError: "reject" });
    const result = await parseImportRequest(req as never, columns, getDataLimits());
    expect(result.ok).toBe(false);
  });

  it("respects an explicit mapping, onError=skip and mode=replace", async () => {
    const req = requestWith({
      file: csvFile("A,B\nx,bad\nPLY-1,5\n"),
      mapping: JSON.stringify({ sku: 0, qty: 1 }),
      onError: "skip",
      mode: "replace",
    });
    const result = await parseImportRequest(req as never, columns, getDataLimits());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.mode).toBe("replace");
    expect(result.result.errorRows).toBe(1); // "bad" is not a valid integer
    expect(result.result.acceptedRows).toBe(1);
    expect(result.result.canImport).toBe(true); // onError=skip lets valid rows through
  });

  it("rejects a file over the configured size limit", async () => {
    const limits = { ...getDataLimits(), maxFileBytes: 10 };
    const req = requestWith({ file: csvFile("SKU,Quantity\nPLY-1,10\n") });
    const result = await parseImportRequest(req as never, columns, limits);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/larger than/);
  });

  it("rejects invalid mapping JSON", async () => {
    const req = requestWith({ file: csvFile("SKU\nPLY-1\n"), mapping: "{not json" });
    const result = await parseImportRequest(req as never, columns, getDataLimits());
    expect(result.ok).toBe(false);
  });
});
