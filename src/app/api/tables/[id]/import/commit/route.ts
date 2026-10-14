import { NextResponse, type NextRequest } from "next/server";

import { getAuthUser } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";
import { BackendError } from "@/lib/backend/port";
import { getDataLimits } from "@/lib/data/limits";
import { parseImportRequest } from "@/lib/import/request";

// POST multipart/form-data: the SAME fields as preview, plus mode
// (append|replace). Re-parses and re-validates the file from scratch (never
// trusts a client-echoed row list), then only commits if every row is still
// valid. `replace` requires table-manage access; `append` requires
// import-or-manage, both enforced by the backend, not by this handler.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ message: "Sign in to import data." }, { status: 401 });

  const { id: tableId } = await params;
  const backend = await getBackend();
  const table = await backend.data.getTable(tableId);
  if (!table) return NextResponse.json({ message: "That table no longer exists." }, { status: 404 });
  if (!table.access.import && !table.access.manage) {
    return NextResponse.json({ message: "You do not have permission to import into this table." }, { status: 403 });
  }

  const parsed = await parseImportRequest(request, table.columns, getDataLimits());
  if (!parsed.ok) return NextResponse.json({ message: parsed.message }, { status: 400 });
  if (!parsed.result.canImport) {
    return NextResponse.json({ message: parsed.result.blockedReason ?? "The file cannot be imported.", issues: parsed.result.issues }, { status: 422 });
  }

  try {
    const outcome = await backend.data.importRows(tableId, parsed.mode, parsed.result.rows, parsed.fileName);
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 });
  } catch (error) {
    if (error instanceof BackendError) {
      const status = error.kind === "forbidden" ? 403 : error.kind === "limit" ? 429 : error.kind === "invalid" ? 400 : error.kind === "unavailable" ? 503 : 500;
      return NextResponse.json({ message: error.message }, { status });
    }
    throw error;
  }
}
