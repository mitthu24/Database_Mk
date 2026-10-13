"use server";

import { z } from "zod";

import { requireUser } from "@/lib/auth/dal";
import { type ActionState } from "@/lib/auth/validation";
import { getBackend } from "@/lib/backend";
import { BackendError } from "@/lib/backend/port";
import { makeColumnKey } from "@/lib/data/columns";
import { COLUMN_TYPES, type ColumnDef, type ImportOutcome, type RowData, type RowPage, type RowQuery, type TableSummary } from "@/lib/data/types";

// Thin server actions over DataPort for the table library / grid UI. Every
// operation is re-authorized by the backend itself (RLS / mock rules); these
// wrappers only validate shape and translate BackendError into UI-safe text.

const GENERIC_ERROR = "Something went wrong. Please try again.";

const columnInputSchema = z.object({
  label: z.string().trim().min(1, "Give the column a name.").max(120, "Use at most 120 characters."),
  type: z.enum(COLUMN_TYPES),
  required: z.boolean().optional(),
});

function toMessage(error: unknown): string {
  return error instanceof BackendError ? error.message : GENERIC_ERROR;
}

export type TableActionState = ActionState & { tableId?: string };

export async function createTable(_prev: TableActionState | undefined, formData: FormData): Promise<TableActionState> {
  await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  if (name.length < 1 || name.length > 120) {
    return { fieldErrors: { name: ["Give the table a name (up to 120 characters)."] } };
  }

  let columns: ColumnDef[];
  try {
    const raw = JSON.parse(String(formData.get("columns") ?? "[]")) as unknown[];
    const parsed = z.array(columnInputSchema).min(1, "Add at least one column.").max(200).parse(raw);
    const keys: string[] = [];
    columns = parsed.map((c) => {
      const key = makeColumnKey(c.label, keys);
      keys.push(key);
      return { key, label: c.label, type: c.type, required: c.required };
    });
  } catch {
    return { message: "Add at least one valid column." };
  }

  try {
    const backend = await getBackend();
    const table = await backend.data.createTable(name, columns);
    return { ok: true, tableId: table.id };
  } catch (error) {
    if (error instanceof BackendError && error.kind === "conflict") return { fieldErrors: { name: [error.message] } };
    if (error instanceof BackendError && error.kind === "invalid") return { message: error.message };
    return { message: toMessage(error) };
  }
}

export async function renameTable(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  await requireUser();
  const tableId = String(formData.get("tableId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!tableId) return { message: GENERIC_ERROR };
  if (name.length < 1 || name.length > 120) return { fieldErrors: { name: ["Use 1-120 characters."] } };

  try {
    const backend = await getBackend();
    await backend.data.renameTable(tableId, name);
    return { ok: true };
  } catch (error) {
    if (error instanceof BackendError && error.kind === "conflict") return { fieldErrors: { name: [error.message] } };
    return { message: toMessage(error) };
  }
}

export async function updateTableSchema(tableId: string, columns: ColumnDef[]): Promise<{ ok: true; table: TableSummary } | { ok: false; message: string }> {
  await requireUser();
  try {
    const backend = await getBackend();
    const table = await backend.data.updateTableSchema(tableId, columns);
    return { ok: true, table };
  } catch (error) {
    return { ok: false, message: toMessage(error) };
  }
}

export async function clearTable(tableId: string): Promise<{ ok: true; deleted: number } | { ok: false; message: string }> {
  await requireUser();
  try {
    const backend = await getBackend();
    const deleted = await backend.data.clearTable(tableId);
    return { ok: true, deleted };
  } catch (error) {
    return { ok: false, message: toMessage(error) };
  }
}

export async function dropTable(tableId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireUser();
  try {
    const backend = await getBackend();
    await backend.data.dropTable(tableId);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: toMessage(error) };
  }
}

export async function queryRows(tableId: string, query: RowQuery): Promise<{ ok: true; page: RowPage } | { ok: false; message: string }> {
  await requireUser();
  try {
    const backend = await getBackend();
    const page = await backend.data.queryRows(tableId, query);
    return { ok: true, page };
  } catch (error) {
    return { ok: false, message: toMessage(error) };
  }
}

export async function insertRow(tableId: string, data: RowData): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireUser();
  try {
    const backend = await getBackend();
    await backend.data.insertRow(tableId, data);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: toMessage(error) };
  }
}

export async function updateRow(tableId: string, rowId: string, data: RowData): Promise<{ ok: true } | { ok: false; message: string }> {
  await requireUser();
  try {
    const backend = await getBackend();
    await backend.data.updateRow(tableId, rowId, data);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: toMessage(error) };
  }
}

export async function deleteRows(tableId: string, rowIds: string[]): Promise<{ ok: true; deleted: number } | { ok: false; message: string }> {
  await requireUser();
  try {
    const backend = await getBackend();
    const deleted = await backend.data.deleteRows(tableId, rowIds);
    return { ok: true, deleted };
  } catch (error) {
    return { ok: false, message: toMessage(error) };
  }
}

export type { ImportOutcome };
