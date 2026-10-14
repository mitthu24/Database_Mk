import { NextResponse, type NextRequest } from "next/server";

import { getAuthUser } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";
import { BackendError } from "@/lib/backend/port";
import { getDataLimits } from "@/lib/data/limits";
import type { ColumnDef, RowData, RowFilter } from "@/lib/data/types";
import { buildXlsx, CSV_BOM, csvHeader, csvRows, EXPORT_CONTENT_TYPES, jsonRecord, safeFileName } from "@/lib/export/formats";

// GET /api/tables/:id/export?format=csv|xlsx|json&search=&sortKey=&sortDir=asc|desc&filters=<json>
//
// authorizeExport() is called FIRST and must succeed before any row is read:
// this is the server-side authorization gate, not a UI-only check. The export
// itself pages through queryRows server-side (never loads more than one page
// of rows into memory at a time) up to the configured row limit.

const FORMATS = new Set(["csv", "xlsx", "json"]);

function errorStatus(kind: BackendError["kind"]): number {
  switch (kind) {
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "invalid":
      return 400;
    case "limit":
      return 429;
    case "unavailable":
      return 503;
    default:
      return 500;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ message: "Sign in to export data." }, { status: 401 });

  const { id: tableId } = await params;
  const url = request.nextUrl;
  const format = url.searchParams.get("format") ?? "csv";
  if (!FORMATS.has(format)) return NextResponse.json({ message: "Unsupported export format." }, { status: 400 });

  const search = url.searchParams.get("search") ?? undefined;
  const sortKey = url.searchParams.get("sortKey") ?? undefined;
  const sortDirRaw = url.searchParams.get("sortDir");
  const sortDir = sortDirRaw === "desc" ? "desc" : "asc";
  let filters: RowFilter[] | undefined;
  const rawFilters = url.searchParams.get("filters");
  if (rawFilters) {
    try {
      filters = JSON.parse(rawFilters);
    } catch {
      return NextResponse.json({ message: "The filters parameter is not valid JSON." }, { status: 400 });
    }
  }

  const backend = await getBackend();

  try {
    // Server-side authorization gate — must succeed before any row is read.
    await backend.data.authorizeExport(tableId);
  } catch (error) {
    if (error instanceof BackendError) return NextResponse.json({ message: error.message }, { status: errorStatus(error.kind) });
    return NextResponse.json({ message: "Export failed." }, { status: 500 });
  }

  const table = await backend.data.getTable(tableId);
  if (!table) return NextResponse.json({ message: "That table no longer exists." }, { status: 404 });

  const limits = getDataLimits();
  const columns: ColumnDef[] = table.columns;
  const filename = safeFileName(table.name, format);

  async function* pages(): AsyncGenerator<RowData[]> {
    let offset = 0;
    let fetched = 0;
    for (;;) {
      const remaining = limits.maxExportRows - fetched;
      if (remaining <= 0) return;
      const limit = Math.min(limits.exportPageSize, remaining);
      const page = await backend.data.queryRows(tableId, { search, sortKey, sortDir, filters, offset, limit });
      if (page.rows.length === 0) return;
      yield page.rows.map((r) => r.data);
      fetched += page.rows.length;
      offset += page.rows.length;
      if (page.rows.length < limit) return;
    }
  }

  const headers = new Headers({
    "Content-Type": EXPORT_CONTENT_TYPES[format as keyof typeof EXPORT_CONTENT_TYPES],
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });

  try {
    if (format === "xlsx") {
      const bytes = await buildXlsx(table.name, columns, pages());
      return new NextResponse(new Blob([bytes.slice().buffer as ArrayBuffer]), { headers });
    }

    if (format === "csv") {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(CSV_BOM + csvHeader(columns)));
          try {
            for await (const page of pages()) {
              controller.enqueue(encoder.encode(csvRows(columns, page)));
            }
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
      return new NextResponse(stream, { headers });
    }

    // json: an array of objects keyed by column label, streamed page by page.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("["));
        let first = true;
        try {
          for await (const page of pages()) {
            for (const row of page) {
              controller.enqueue(encoder.encode((first ? "" : ",") + JSON.stringify(jsonRecord(columns, row))));
              first = false;
            }
          }
          controller.enqueue(encoder.encode("]"));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });
    return new NextResponse(stream, { headers });
  } catch (error) {
    if (error instanceof BackendError) return NextResponse.json({ message: error.message }, { status: errorStatus(error.kind) });
    throw error;
  }
}
