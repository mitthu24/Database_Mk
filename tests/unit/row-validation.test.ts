import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { makeColumnKey, describeSchemaChange, normalizeName } from "@/lib/data/columns";
import { isRealCalendarDate, rowError, validateColumns } from "@/lib/data/row-validation";
import type { ColumnDef } from "@/lib/data/types";

// The SAME file is executed by the SQL validator in tests/db/45_data_engine.sql.
const shared = JSON.parse(readFileSync(join(__dirname, "../shared/row-validation-vectors.json"), "utf8")) as {
  columns: ColumnDef[];
  vectors: { desc: string; data: unknown; error: string | null }[];
  column_vectors: { desc: string; columns: unknown; error: string | null }[];
};

describe("shared row-validation vectors (parity with private.row_error)", () => {
  it.each(shared.vectors.map((v) => [v.desc, v] as const))("%s", (_desc, v) => {
    expect(rowError(shared.columns, v.data)).toBe(v.error);
  });
});

describe("shared column-definition vectors (parity with private.validate_columns)", () => {
  it.each(shared.column_vectors.map((v) => [v.desc, v] as const))("%s", (_desc, v) => {
    expect(validateColumns(v.columns)).toBe(v.error);
  });
});

describe("isRealCalendarDate", () => {
  it.each([
    ["2026-02-28", true],
    ["2028-02-29", true],
    ["2027-02-29", false],
    ["2026-04-31", false],
    ["2026-13-01", false],
    ["2026-00-10", false],
    ["0000-01-01", false],
    ["0001-01-01", true],
    ["9999-12-31", true],
  ])("%s -> %s", (s, ok) => expect(isRealCalendarDate(s)).toBe(ok));
});

describe("makeColumnKey", () => {
  it("slugifies labels into valid keys", () => {
    expect(makeColumnKey("Unit Price ($)")).toBe("unit_price");
    expect(makeColumnKey("Café Ñandú")).toBe("cafe_nandu");
    expect(makeColumnKey("  --  ")).toBe("column");
    expect(makeColumnKey("2024 Sales")).toBe("c_2024_sales");
    expect(makeColumnKey("日本語")).toBe("column");
  });
  it("is unique and within 40 characters", () => {
    expect(makeColumnKey("Name", ["name"])).toBe("name_2");
    expect(makeColumnKey("Name", ["name", "name_2"])).toBe("name_3");
    const long = makeColumnKey("a".repeat(80), ["a".repeat(40)]);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).not.toBe("a".repeat(40));
    expect(validateColumns([{ key: long, label: "x", type: "text" }])).toBeNull();
  });
  it("always yields a key the validator accepts", () => {
    for (const label of ["Weird !!", "123", "_", "ÀÉÎ", "a-b-c", "UPPER", "x".repeat(200)]) {
      const key = makeColumnKey(label);
      expect(validateColumns([{ key, label: "x", type: "text" }]), label).toBeNull();
    }
  });
});

describe("describeSchemaChange / normalizeName", () => {
  const a: ColumnDef[] = [
    { key: "sku", label: "SKU", type: "text" },
    { key: "qty", label: "Qty", type: "integer" },
    { key: "old", label: "Old", type: "text" },
  ];
  const b: ColumnDef[] = [
    { key: "sku", label: "SKU code", type: "text" },
    { key: "qty", label: "Qty", type: "number" },
    { key: "fresh", label: "Fresh", type: "date" },
  ];
  it("classifies added, removed, retyped and relabelled columns", () => {
    const d = describeSchemaChange(a, b);
    expect(d.added.map((c) => c.key)).toEqual(["fresh"]);
    expect(d.removed.map((c) => c.key)).toEqual(["old"]);
    expect(d.retyped.map((c) => c.key)).toEqual(["qty"]);
    expect(d.relabelled.map((c) => c.key)).toEqual(["sku"]);
  });
  it("matches names loosely", () => {
    expect(normalizeName("Unit Price")).toBe(normalizeName("unit_price"));
    expect(normalizeName("UNIT-PRICE")).toBe("unitprice");
  });
});
