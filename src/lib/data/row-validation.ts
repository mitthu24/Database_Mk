import { COLUMN_TYPES, type ColumnDef } from "@/lib/data/types";

// TypeScript MIRROR of private.validate_columns / private.row_error in
// supabase/migrations/20261013170000_m2_05_data_engine.sql. The database is the
// authority; this copy gives instant feedback and powers the mock backend.
// tests/shared/row-validation-vectors.json is executed by BOTH implementations,
// so any drift fails a test on one side or the other. Messages must match exactly.

const KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
const DATE_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const DATETIME_RE =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ]([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9](\.[0-9]+)?)?(Z|[+-]([01][0-9]|2[0-3])(:?[0-5][0-9])?)?$/;

export const MAX_TEXT_CHARS = 10000;
export const MAX_COLUMNS = 200;
const MAX_SAFE = 9007199254740991;

/** True when y-m-d is a real proleptic-Gregorian calendar date (years 1-9999). */
export function isRealCalendarDate(ymd: string): boolean {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(5, 7));
  const d = Number(ymd.slice(8, 10));
  if (y < 1) return false;
  const dt = new Date(Date.UTC(2000, 0, 1));
  dt.setUTCFullYear(y, m - 1, d);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// SQL btrim() trims SPACES only (not tabs/newlines); match it exactly.
function isBlank(s: string): boolean {
  return s.replace(/^ +| +$/g, "") === "";
}

function codePointLength(s: string): number {
  return s.length <= MAX_TEXT_CHARS ? s.length : Array.from(s).length;
}

export function validateColumns(cols: unknown): string | null {
  if (!Array.isArray(cols)) return "columns must be a list";
  if (cols.length > MAX_COLUMNS) return "a table can have at most 200 columns";

  const keys = new Set<string>();
  const labels = new Set<string>();
  for (const c of cols) {
    if (typeof c !== "object" || c === null || Array.isArray(c)) return "each column must be an object";
    const col = c as Record<string, unknown>;
    if (Object.keys(col).some((k) => !["key", "label", "type", "required"].includes(k))) {
      return "unknown column property";
    }
    if (typeof col.key !== "string" || !KEY_RE.test(col.key)) {
      return "column keys must be 1-40 characters: lowercase letters, digits, underscore, starting with a letter";
    }
    if (typeof col.label !== "string") return "column label is required";
    const label = col.label.replace(/^ +| +$/g, "");
    const len = Array.from(label).length;
    if (len < 1 || len > 120) return "column labels must be 1-120 characters";
    if (typeof col.type !== "string" || !(COLUMN_TYPES as readonly string[]).includes(col.type)) {
      return "column type must be text, number, integer, boolean, date or datetime";
    }
    if ("required" in col && typeof col.required !== "boolean") return "column required flag must be true or false";
    if (keys.has(col.key)) return `duplicate column key "${col.key}"`;
    if (labels.has(label.toLowerCase())) return `duplicate column name "${label}"`;
    keys.add(col.key);
    labels.add(label.toLowerCase());
  }
  return null;
}

export function rowError(columns: ColumnDef[], data: unknown): string | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return "row must be an object";
  const row = data as Record<string, unknown>;
  const known = new Set(columns.map((c) => c.key));

  for (const k of Object.keys(row)) {
    if (!known.has(k)) return `unknown column "${Array.from(k).slice(0, 40).join("")}"`;
  }

  for (const c of columns) {
    const v = row[c.key];
    const required = c.required === true;
    if (v === undefined || v === null) {
      if (required) return `${c.label} is required`;
      continue;
    }

    switch (c.type) {
      case "text": {
        if (typeof v !== "string") return `${c.label} must be text`;
        if (codePointLength(v) > MAX_TEXT_CHARS) return `${c.label} is too long (10000 characters maximum)`;
        if (required && isBlank(v)) return `${c.label} is required`;
        break;
      }
      case "number": {
        if (typeof v !== "number" || !Number.isFinite(v)) return `${c.label} must be a number`;
        break;
      }
      case "integer": {
        if (typeof v !== "number" || !Number.isFinite(v)) return `${c.label} must be a whole number`;
        if (!Number.isInteger(v) || Math.abs(v) > MAX_SAFE) return `${c.label} must be a whole number`;
        break;
      }
      case "boolean": {
        if (typeof v !== "boolean") return `${c.label} must be true or false`;
        break;
      }
      case "date": {
        if (typeof v !== "string" || !DATE_RE.test(v)) return `${c.label} must be a date (YYYY-MM-DD)`;
        if (!isRealCalendarDate(v)) return `${c.label} is not a real calendar date`;
        break;
      }
      case "datetime": {
        if (typeof v !== "string" || !DATETIME_RE.test(v)) return `${c.label} must be a date and time (ISO 8601)`;
        if (!isRealCalendarDate(v.slice(0, 10))) return `${c.label} is not a real date and time`;
        break;
      }
    }
  }
  return null;
}

export { DATETIME_RE, DATE_RE };
