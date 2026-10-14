import { NextResponse, type NextRequest } from "next/server";

import { getAuthUser } from "@/lib/auth/dal";
import { getBackend } from "@/lib/backend";
import { getDataLimits } from "@/lib/data/limits";
import { parseImportRequest } from "@/lib/import/request";

// Route Handler (not a Server Action): a multipart file upload has no 1 MB
// Server Action body cap here.

// POST multipart/form-data: file, mapping? (JSON), onError (reject|skip),
// skipDuplicates (true|false), sheet? — parses and validates the file against
// the table's CURRENT schema, re-validating server-side regardless of what
// the browser already checked. Never commits anything.
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

  // The preview response never echoes the full validated row payload, only a
  // small sample for review; committing re-uploads the same file and re-runs
  // this exact validation server-side (nothing from this response is trusted).
  const { rows, ...preview } = parsed.result;
  void rows;
  return NextResponse.json(preview);
}
