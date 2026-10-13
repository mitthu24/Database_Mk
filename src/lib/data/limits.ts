// Import/export limits. Defaults are deliberately modest for an MVP and can be
// lowered (never raised past the hard ceilings) through environment variables.
// The hard ceilings match what the platform can actually carry:
//  * 4.25 MB: Vercel serverless functions accept request bodies up to 4.5 MB.
//  * 50,000 rows per import: the database function rejects more than that.

export interface DataLimits {
  maxFileBytes: number;
  maxImportRows: number;
  maxColumns: number;
  maxZipEntries: number;
  maxZipUncompressedBytes: number;
  previewRows: number;
  maxIssuesShown: number;
  maxExportRows: number;
  exportPageSize: number;
}

export const HARD_LIMITS = {
  maxFileBytes: 4.25 * 1024 * 1024,
  maxImportRows: 50_000,
  maxExportRows: 250_000,
} as const;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = raw === undefined || raw.trim() === "" ? NaN : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.floor(n), min), max);
}

export function getDataLimits(env: Record<string, string | undefined> = process.env): DataLimits {
  return {
    maxFileBytes: Math.floor(
      clampInt(env.IMPORT_MAX_FILE_KB, 4096, 1, Math.floor(HARD_LIMITS.maxFileBytes / 1024)) * 1024,
    ),
    maxImportRows: clampInt(env.IMPORT_MAX_ROWS, 20_000, 1, HARD_LIMITS.maxImportRows),
    maxColumns: 200,
    maxZipEntries: 200,
    maxZipUncompressedBytes: 64 * 1024 * 1024,
    previewRows: 20,
    maxIssuesShown: 50,
    maxExportRows: clampInt(env.EXPORT_MAX_ROWS, 100_000, 1, HARD_LIMITS.maxExportRows),
    exportPageSize: 500,
  };
}
