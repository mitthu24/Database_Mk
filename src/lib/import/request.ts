import type { NextRequest } from "next/server";

import type { DataLimits } from "@/lib/data/limits";
import type { ColumnDef } from "@/lib/data/types";
import { ImportFileError, parseUpload } from "@/lib/import/parse";
import { runPipeline, type ColumnMapping, type PipelineResult } from "@/lib/import/pipeline";

export type ImportRequestResult =
  | { ok: true; result: PipelineResult; fileName: string; mode: "append" | "replace" }
  | { ok: false; message: string };

/** Shared multipart parsing + pipeline run for the preview and commit Route Handlers. */
export async function parseImportRequest(request: NextRequest, columns: ColumnDef[], limits: DataLimits): Promise<ImportRequestResult> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, message: "Could not read the uploaded file." };
  }

  const file = form.get("file");
  if (!(file instanceof File)) return { ok: false, message: "No file was uploaded." };
  if (file.size > limits.maxFileBytes) {
    return { ok: false, message: `The file is larger than ${Math.floor(limits.maxFileBytes / 1024 / 1024)} MB.` };
  }

  const onErrorRaw = String(form.get("onError") ?? "reject");
  const onError = onErrorRaw === "skip" ? "skip" : "reject";
  const skipDuplicates = String(form.get("skipDuplicates") ?? "false") === "true";
  const modeRaw = String(form.get("mode") ?? "append");
  const mode: "append" | "replace" = modeRaw === "replace" ? "replace" : "append";
  const sheet = typeof form.get("sheet") === "string" ? String(form.get("sheet")) : undefined;

  let mapping: ColumnMapping | undefined;
  const rawMapping = form.get("mapping");
  if (typeof rawMapping === "string" && rawMapping.trim()) {
    try {
      mapping = JSON.parse(rawMapping) as ColumnMapping;
    } catch {
      return { ok: false, message: "The column mapping is not valid." };
    }
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  try {
    const parsed = await parseUpload({ name: file.name, bytes }, limits, { sheet });
    const result = runPipeline(parsed, { columns, mapping, onError, skipDuplicates, limits });
    return { ok: true, result, fileName: file.name, mode };
  } catch (error) {
    if (error instanceof ImportFileError) return { ok: false, message: error.message };
    throw error;
  }
}
