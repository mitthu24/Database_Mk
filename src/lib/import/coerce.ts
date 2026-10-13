import type { ColumnDef, JsonPrimitive } from "@/lib/data/types";
import { DATE_RE, DATETIME_RE, isRealCalendarDate } from "@/lib/data/row-validation";
import { CellError, type RawCell } from "@/lib/import/parse";

export type CoerceResult = { ok: true; value: JsonPrimitive } | { ok: false; message: string };

const NUMBER_RE = /^[+-]?(\d+(\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;
const GROUPED_NUMBER_RE = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/;
const TRUE_WORDS = new Set(["true", "t", "yes", "y", "1"]);
const FALSE_WORDS = new Set(["false", "f", "no", "n", "0"]);

function isEmpty(raw: RawCell): boolean {
  return raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "");
}

function parseNumber(raw: RawCell): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (NUMBER_RE.test(s)) return Number(s);
  if (GROUPED_NUMBER_RE.test(s)) return Number(s.replace(/,/g, ""));
  return null;
}

function pad(n: number, w = 2) {
  return String(n).padStart(w, "0");
}

/** Convert one raw cell to the JSON value for `col`, or explain why it cannot be. */
export function coerceCell(raw: RawCell, col: ColumnDef): CoerceResult {
  if (raw instanceof CellError) return { ok: false, message: `contains a spreadsheet error (${raw.code})` };
  if (isEmpty(raw)) return { ok: true, value: null };
  if (typeof raw === "object" && !(raw instanceof Date)) {
    return { ok: false, message: "contains a nested value, which is not supported" };
  }

  switch (col.type) {
    case "text": {
      if (raw instanceof Date) return { ok: true, value: raw.toISOString() };
      return { ok: true, value: String(raw) };
    }
    case "number":
    case "integer": {
      const n = parseNumber(raw);
      if (n === null) return { ok: false, message: `"${String(raw).slice(0, 40)}" is not a number` };
      if (col.type === "integer" && (!Number.isInteger(n) || Math.abs(n) > Number.MAX_SAFE_INTEGER)) {
        return { ok: false, message: `"${String(raw).slice(0, 40)}" is not a whole number` };
      }
      return { ok: true, value: n };
    }
    case "boolean": {
      if (typeof raw === "boolean") return { ok: true, value: raw };
      const s = String(raw).trim().toLowerCase();
      if (TRUE_WORDS.has(s)) return { ok: true, value: true };
      if (FALSE_WORDS.has(s)) return { ok: true, value: false };
      return { ok: false, message: `"${String(raw).slice(0, 40)}" is not yes/no or true/false` };
    }
    case "date": {
      if (raw instanceof Date) {
        if (Number.isNaN(raw.getTime())) return { ok: false, message: "is not a valid date" };
        return { ok: true, value: `${pad(raw.getUTCFullYear(), 4)}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}` };
      }
      const s = String(raw).trim().replace(/^(\d{4})\/(\d{2})\/(\d{2})$/, "$1-$2-$3");
      if (!DATE_RE.test(s) || !isRealCalendarDate(s)) {
        return { ok: false, message: `"${String(raw).slice(0, 40)}" is not a date. Use YYYY-MM-DD` };
      }
      return { ok: true, value: s };
    }
    case "datetime": {
      if (raw instanceof Date) {
        if (Number.isNaN(raw.getTime())) return { ok: false, message: "is not a valid date and time" };
        return { ok: true, value: raw.toISOString() };
      }
      const s = String(raw).trim();
      if (!DATETIME_RE.test(s) || !isRealCalendarDate(s.slice(0, 10))) {
        return { ok: false, message: `"${String(raw).slice(0, 40)}" is not a date and time. Use YYYY-MM-DDTHH:MM:SS` };
      }
      return { ok: true, value: s };
    }
  }
}
