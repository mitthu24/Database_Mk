import { beforeEach, describe, expect, it, vi } from "vitest";

import { BackendError } from "@/lib/backend/port";

const requireUser = vi.fn();
const getBackend = vi.fn();

vi.mock("@/lib/auth/dal", () => ({ requireUser: () => requireUser() }));
vi.mock("@/lib/backend", () => ({ getBackend: () => getBackend() }));

import { clearTable, createTable, deleteRows, dropTable, renameTable, updateTableSchema } from "@/lib/tables/actions";

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  requireUser.mockReset();
  getBackend.mockReset();
});

describe("createTable", () => {
  it("derives stable, de-duplicated column keys from labels and creates the table", async () => {
    const createTableFn = vi.fn().mockResolvedValue({ id: "t1" });
    getBackend.mockResolvedValue({ data: { createTable: createTableFn } });

    const columns = [
      { label: "SKU", type: "text", required: true },
      { label: "SKU", type: "text" }, // duplicate label -> unique key
    ];
    const result = await createTable(undefined, form({ name: "Orders", columns: JSON.stringify(columns) }));

    expect(result.ok).toBe(true);
    expect(result.tableId).toBe("t1");
    expect(createTableFn).toHaveBeenCalledWith(
      "Orders",
      expect.arrayContaining([
        expect.objectContaining({ key: "sku", label: "SKU", required: true }),
        expect.objectContaining({ key: "sku_2", label: "SKU" }),
      ]),
    );
  });

  it("rejects an empty name without calling the backend", async () => {
    const result = await createTable(undefined, form({ name: "", columns: "[]" }));
    expect(result.fieldErrors?.name).toBeTruthy();
    expect(getBackend).not.toHaveBeenCalled();
  });

  it("rejects when there are no valid columns", async () => {
    const result = await createTable(undefined, form({ name: "Orders", columns: "[]" }));
    expect(result.message).toBeTruthy();
    expect(getBackend).not.toHaveBeenCalled();
  });

  it("surfaces a duplicate-name conflict on the name field", async () => {
    getBackend.mockResolvedValue({ data: { createTable: vi.fn().mockRejectedValue(new BackendError("conflict", "A table with that name already exists.")) } });
    const result = await createTable(undefined, form({ name: "Orders", columns: JSON.stringify([{ label: "A", type: "text" }]) }));
    expect(result.fieldErrors?.name?.[0]).toMatch(/already exists/);
  });
});

describe("renameTable", () => {
  it("validates length and calls the backend", async () => {
    const renameTableFn = vi.fn();
    getBackend.mockResolvedValue({ data: { renameTable: renameTableFn } });
    const result = await renameTable(undefined, form({ tableId: "t1", name: "New name" }));
    expect(result.ok).toBe(true);
    expect(renameTableFn).toHaveBeenCalledWith("t1", "New name");
  });
  it("rejects an empty name", async () => {
    const result = await renameTable(undefined, form({ tableId: "t1", name: "" }));
    expect(result.fieldErrors?.name).toBeTruthy();
    expect(getBackend).not.toHaveBeenCalled();
  });
});

describe("mutation wrappers map BackendError to a safe message", () => {
  it("updateTableSchema", async () => {
    getBackend.mockResolvedValue({ data: { updateTableSchema: vi.fn().mockRejectedValue(new BackendError("invalid", "bad schema")) } });
    const result = await updateTableSchema("t1", []);
    expect(result).toEqual({ ok: false, message: "bad schema" });
  });
  it("clearTable success", async () => {
    getBackend.mockResolvedValue({ data: { clearTable: vi.fn().mockResolvedValue(7) } });
    expect(await clearTable("t1")).toEqual({ ok: true, deleted: 7 });
  });
  it("dropTable forbidden", async () => {
    getBackend.mockResolvedValue({ data: { dropTable: vi.fn().mockRejectedValue(new BackendError("forbidden", "nope")) } });
    expect(await dropTable("t1")).toEqual({ ok: false, message: "nope" });
  });
  it("deleteRows success", async () => {
    getBackend.mockResolvedValue({ data: { deleteRows: vi.fn().mockResolvedValue(3) } });
    expect(await deleteRows("t1", ["r1", "r2", "r3"])).toEqual({ ok: true, deleted: 3 });
  });
});
