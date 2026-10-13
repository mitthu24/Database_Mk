import type { ColumnDef } from "@/lib/data/types";

/** Derive a stable column key (a-z0-9_, starts with a letter, max 40) from a human label. */
export function makeColumnKey(label: string, existing: Iterable<string> = []): string {
  const taken = new Set(existing);
  let base = label
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (base === "") base = "column";
  if (!/^[a-z]/.test(base)) base = `c_${base}`;
  base = base.slice(0, 40).replace(/_+$/g, "") || "column";

  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const suffix = `_${i}`;
    const candidate = base.slice(0, 40 - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("could not derive a unique column key");
}

/** Compare two column lists and describe the structural effect of switching from `before` to `after`. */
export function describeSchemaChange(before: ColumnDef[], after: ColumnDef[]) {
  const beforeMap = new Map(before.map((c) => [c.key, c]));
  const afterMap = new Map(after.map((c) => [c.key, c]));
  return {
    added: after.filter((c) => !beforeMap.has(c.key)),
    removed: before.filter((c) => !afterMap.has(c.key)),
    retyped: after.filter((c) => {
      const old = beforeMap.get(c.key);
      return old !== undefined && old.type !== c.type;
    }),
    relabelled: after.filter((c) => {
      const old = beforeMap.get(c.key);
      return old !== undefined && old.label !== c.label;
    }),
  };
}

/** Normalize a header/label for loose matching ("Unit Price", "unit_price", "UNIT-PRICE" all equal). */
export function normalizeName(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
