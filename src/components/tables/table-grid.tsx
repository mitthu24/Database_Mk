"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Loader2, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RowFormDialog } from "@/components/tables/row-form-dialog";
import { RenameTableDialog } from "@/components/tables/rename-table-dialog";
import { SchemaEditorDialog } from "@/components/tables/schema-editor-dialog";
import type { RowRecord, TableSummary } from "@/lib/data/types";
import { clearTable, deleteRows, dropTable, queryRows } from "@/lib/tables/actions";

const PAGE_SIZES = [25, 50, 100];
const MIN_COL_WIDTH = 100;

function formatCell(value: unknown, type: TableSummary["columns"][number]["type"]): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function TableGrid({ table, companyAccess }: { table: TableSummary; companyAccess: "full" | "read_only" | "suspended" | "none" | "disabled" }) {
  const router = useRouter();
  const [current, setCurrent] = useState(table);
  const [rows, setRows] = useState<RowRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // A single state object: changing search/sort/page-size always resets to
  // page 0 in the same update, so no separate "reset page" effect is needed.
  const [query, setQuery] = useState<{ page: number; pageSize: number; search: string; sortKey: string | null; sortDir: "asc" | "desc" }>({
    page: 0,
    pageSize: 25,
    search: "",
    sortKey: null,
    sortDir: "asc",
  });
  const { page, pageSize, search, sortKey, sortDir } = query;
  const [reloadTick, setReloadTick] = useState(0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [widths, setWidths] = useState<Record<string, number>>({});

  const [rowDialog, setRowDialog] = useState<{ open: boolean; row: RowRecord | null }>({ open: false, row: null });
  const [renameOpen, setRenameOpen] = useState(false);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [dropOpen, setDropOpen] = useState(false);
  const [busy, setBusy] = useState<"clear" | "drop" | "delete" | null>(null);

  const access = current.access;
  const canWrite = companyAccess === "full";

  // Fetches the current page of rows whenever the table, the query, or
  // reloadTick (bumped after a mutation) changes. Data fetching on
  // mount/dependency change is an intentional, standard use of an effect.
  useEffect(() => {
    // Intentional: show a loading state immediately while the fetch below is in flight.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    let active = true;
    queryRows(current.id, { search: search || undefined, sortKey: sortKey ?? undefined, sortDir, offset: page * pageSize, limit: pageSize })
      .then((result) => {
        if (!active) return;
        if (!result.ok) {
          setError(result.message);
          return;
        }
        setRows(result.page.rows);
        setTotal(result.page.total);
        setSelected(new Set());
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [current.id, search, sortKey, sortDir, page, pageSize, reloadTick]);

  const load = useCallback(() => setReloadTick((t) => t + 1), []);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggleSort(key: string) {
    setQuery((q) => (q.sortKey === key ? { ...q, sortDir: q.sortDir === "asc" ? "desc" : "asc", page: 0 } : { ...q, sortKey: key, sortDir: "asc", page: 0 }));
  }

  function toggleSelectAll() {
    setSelected(allOnPageSelected ? new Set() : new Set(rows.map((r) => r.id)));
  }

  async function handleDeleteSelected() {
    setBusy("delete");
    const result = await deleteRows(current.id, [...selected]);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Deleted ${result.deleted} ${result.deleted === 1 ? "row" : "rows"}.`);
    load();
  }

  async function handleDeleteOne(rowId: string) {
    setBusy("delete");
    const result = await deleteRows(current.id, [rowId]);
    setBusy(null);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Row deleted.");
    load();
  }

  async function handleClear() {
    setBusy("clear");
    const result = await clearTable(current.id);
    setBusy(null);
    setClearOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success(`Cleared ${result.deleted} ${result.deleted === 1 ? "row" : "rows"}.`);
    load();
  }

  async function handleDrop() {
    setBusy("drop");
    const result = await dropTable(current.id);
    setBusy(null);
    setDropOpen(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    toast.success("Table deleted.");
    router.push("/tables");
  }

  // Column resize: mouse-drag on the handle at the right edge of each header cell.
  const dragRef = useRef<{ key: string; startX: number; startWidth: number } | null>(null);
  const startResize = (key: string, e: React.MouseEvent) => {
    e.preventDefault();
    const startWidth = widths[key] ?? 160;
    dragRef.current = { key, startX: e.clientX, startWidth };
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientX - dragRef.current.startX;
      setWidths((w) => ({ ...w, [dragRef.current!.key]: Math.max(MIN_COL_WIDTH, dragRef.current!.startWidth + delta) }));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const accessLabel = useMemo(() => {
    if (companyAccess === "suspended") return { text: "Suspended — no access", variant: "destructive" as const };
    if (companyAccess === "read_only") return { text: "Read only", variant: "secondary" as const };
    if (!access.view) return { text: "No access", variant: "destructive" as const };
    if (access.manage) return { text: "You manage this table", variant: "accent" as const };
    const can = [access.create && "create", access.edit && "edit", access.delete && "delete", access.import && "import", access.export && "export"].filter(Boolean);
    return { text: can.length ? `View, ${can.join(", ")}` : "View only", variant: "outline" as const };
  }, [access, companyAccess]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{current.name}</h1>
            <Badge variant={accessLabel.variant}>{accessLabel.text}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} {total === 1 ? "row" : "rows"} &middot; {current.columns.length} {current.columns.length === 1 ? "column" : "columns"}
          </p>
        </div>
        {access.manage ? (
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
              Rename
            </Button>
            <Button variant="outline" size="sm" onClick={() => setSchemaOpen(true)}>
              Edit columns
            </Button>
            <Button variant="outline" size="sm" onClick={() => setClearOpen(true)}>
              Clear data
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setDropOpen(true)}>
              Delete table
            </Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input placeholder="Search rows…" className="pl-8" value={search} onChange={(e) => setQuery((q) => ({ ...q, search: e.target.value, page: 0 }))} />
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && access.delete ? (
            <Button variant="destructive" size="sm" disabled={busy === "delete"} onClick={handleDeleteSelected}>
              {busy === "delete" ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              Delete {selected.size} selected
            </Button>
          ) : null}
          {access.create && canWrite ? (
            <Button size="sm" onClick={() => setRowDialog({ open: true, row: null })}>
              <Plus aria-hidden /> Add row
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {!access.view ? (
        <div className="rounded-xl border bg-card py-16 text-center text-sm text-muted-foreground">
          You do not have access to view this table&apos;s data.
        </div>
      ) : (
        <div className="rounded-xl border bg-card">
          <div className="max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  {access.delete ? (
                    <TableHead className="w-10">
                      <Checkbox checked={allOnPageSelected} onCheckedChange={toggleSelectAll} aria-label="Select all rows on this page" />
                    </TableHead>
                  ) : null}
                  {current.columns.map((col) => (
                    <TableHead
                      key={col.key}
                      style={{ width: widths[col.key], minWidth: MIN_COL_WIDTH }}
                      className="relative cursor-pointer select-none"
                      onClick={() => toggleSort(col.key)}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {sortKey === col.key ? (sortDir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />) : null}
                      </span>
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          startResize(col.key, e);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-border"
                      />
                    </TableHead>
                  ))}
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {access.delete ? <TableCell /> : null}
                      {current.columns.map((col) => (
                        <TableCell key={col.key}>
                          <Skeleton className="h-4 w-24" />
                        </TableCell>
                      ))}
                      <TableCell />
                    </TableRow>
                  ))
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={current.columns.length + (access.delete ? 2 : 1)} className="py-10 text-center text-muted-foreground">
                      {search ? "No rows match your search." : "No rows yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => (
                    <TableRow key={row.id} data-state={selected.has(row.id) ? "selected" : undefined}>
                      {access.delete ? (
                        <TableCell>
                          <Checkbox
                            checked={selected.has(row.id)}
                            onCheckedChange={(checked) =>
                              setSelected((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(row.id);
                                else next.delete(row.id);
                                return next;
                              })
                            }
                            aria-label="Select row"
                          />
                        </TableCell>
                      ) : null}
                      {current.columns.map((col) => (
                        <TableCell
                          key={col.key}
                          className={access.edit && canWrite ? "cursor-pointer hover:bg-muted/40" : undefined}
                          onClick={() => access.edit && canWrite && setRowDialog({ open: true, row })}
                        >
                          {formatCell(row.data[col.key], col.type)}
                        </TableCell>
                      ))}
                      <TableCell>
                        {(access.edit || access.delete) && canWrite ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Row actions">
                                <MoreHorizontal aria-hidden />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {access.edit ? <DropdownMenuItem onClick={() => setRowDialog({ open: true, row })}>Edit</DropdownMenuItem> : null}
                              {access.delete ? (
                                <DropdownMenuItem variant="destructive" onClick={() => handleDeleteOne(row.id)}>
                                  Delete
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-3 py-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Rows per page</span>
              <Select value={String(pageSize)} onValueChange={(v) => setQuery((q) => ({ ...q, pageSize: Number(v), page: 0 }))}>
                <SelectTrigger size="sm" className="w-20">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZES.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">
                Page {page + 1} of {totalPages}
              </span>
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setQuery((q) => ({ ...q, page: Math.max(0, q.page - 1) }))}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setQuery((q) => ({ ...q, page: q.page + 1 }))}>
                Next
              </Button>
            </div>
          </div>
        </div>
      )}

      <RowFormDialog
        open={rowDialog.open}
        onOpenChange={(open) => setRowDialog((s) => ({ ...s, open }))}
        tableId={current.id}
        columns={current.columns}
        row={rowDialog.row}
        onSaved={load}
      />
      <RenameTableDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        tableId={current.id}
        currentName={current.name}
        onRenamed={(name) => setCurrent((t) => ({ ...t, name }))}
      />
      <SchemaEditorDialog open={schemaOpen} onOpenChange={setSchemaOpen} table={current} onSaved={(t) => { setCurrent(t); load(); }} />

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all data in &ldquo;{current.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes every row in this table. The table and its columns stay. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy === "clear"} onClick={handleClear}>
              {busy === "clear" ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Clear data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={dropOpen} onOpenChange={setDropOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &ldquo;{current.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the table, its columns and all {total.toLocaleString()} rows. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy === "drop"} onClick={handleDrop}>
              {busy === "drop" ? <Loader2 className="animate-spin" aria-hidden /> : null}
              Delete table
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
