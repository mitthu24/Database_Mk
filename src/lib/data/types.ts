export const COLUMN_TYPES = ["text", "number", "integer", "boolean", "date", "datetime"] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const COLUMN_TYPE_LABELS: Record<ColumnType, string> = {
  text: "Text",
  number: "Number",
  integer: "Whole number",
  boolean: "Yes / No",
  date: "Date",
  datetime: "Date & time",
};

export interface ColumnDef {
  /** Immutable identifier stored in every row. Never changes when the label is edited. */
  key: string;
  label: string;
  type: ColumnType;
  required?: boolean;
}

export type JsonPrimitive = string | number | boolean | null;
export type RowData = Record<string, JsonPrimitive>;

export interface TableAccess {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  import: boolean;
  export: boolean;
  manage: boolean;
}

export interface TableSummary {
  id: string;
  name: string;
  columns: ColumnDef[];
  rowCount: number;
  createdAt: string;
  updatedAt: string;
  dataUpdatedAt: string;
  access: TableAccess;
}

export interface RowRecord {
  id: string;
  rowOrder: number;
  data: RowData;
  createdAt: string;
  updatedAt: string;
}

export const FILTER_OPS = ["eq", "neq", "contains", "gt", "gte", "lt", "lte", "empty", "notempty"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface RowFilter {
  key: string;
  op: FilterOp;
  value?: string;
}

export interface RowQuery {
  search?: string;
  filters?: RowFilter[];
  sortKey?: string;
  sortDir?: "asc" | "desc";
  offset?: number;
  limit?: number;
}

export interface RowPage {
  total: number;
  offset: number;
  limit: number;
  rows: RowRecord[];
}

export type ImportMode = "append" | "replace";

export interface ImportIssue {
  /** 1-based data row number (0 = whole file). */
  row: number;
  message: string;
}

export type ImportOutcome =
  | { ok: true; jobId: string; mode: ImportMode; inserted: number; deleted: number }
  | { ok: false; jobId: string; errorCount: number; errors: ImportIssue[] };

export interface ImportJob {
  id: string;
  tableId: string | null;
  tableName: string;
  mode: ImportMode;
  fileName: string | null;
  status: "succeeded" | "failed";
  rowsReceived: number;
  rowsInserted: number;
  rowsDeleted: number;
  errorCount: number;
  errors: ImportIssue[];
  createdBy: string | null;
  createdAt: string;
}
