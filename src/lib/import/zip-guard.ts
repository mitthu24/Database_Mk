// XLSX files are ZIP archives. Before handing one to a parser that inflates it into
// memory, read the ZIP central directory (cheap, no decompression) and refuse
// archives that declare an implausible amount of data: the classic "zip bomb".

export class ZipGuardError extends Error {
  constructor(
    public readonly reason: "malformed" | "too_many_entries" | "too_large" | "zip64" | "suspicious_name",
    message: string,
  ) {
    super(message);
    this.name = "ZipGuardError";
  }
}

export interface ZipLimits {
  maxEntries: number;
  maxUncompressedBytes: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

export function inspectZip(bytes: Uint8Array, limits: ZipLimits): { entries: number; uncompressed: number } {
  if (bytes.length < 22) throw new ZipGuardError("malformed", "The file is not a valid .xlsx workbook.");
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // End Of Central Directory record: scan backwards (a comment of up to 65535 bytes may follow it).
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipGuardError("malformed", "The file is not a valid .xlsx workbook.");

  const entries = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipGuardError("zip64", "ZIP64 workbooks are not supported.");
  }
  if (entries > limits.maxEntries) {
    throw new ZipGuardError("too_many_entries", "The workbook contains too many internal files.");
  }
  if (cdOffset + cdSize > bytes.length) throw new ZipGuardError("malformed", "The file is not a valid .xlsx workbook.");

  let pos = cdOffset;
  let uncompressed = 0;
  let compressed = 0;
  for (let n = 0; n < entries; n++) {
    if (pos + 46 > bytes.length || dv.getUint32(pos, true) !== CEN_SIG) {
      throw new ZipGuardError("malformed", "The file is not a valid .xlsx workbook.");
    }
    const csize = dv.getUint32(pos + 20, true);
    const usize = dv.getUint32(pos + 24, true);
    const nameLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    if (csize === 0xffffffff || usize === 0xffffffff) {
      throw new ZipGuardError("zip64", "ZIP64 workbooks are not supported.");
    }
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLen));
    if (name.startsWith("/") || name.includes("..") || name.includes("\\")) {
      throw new ZipGuardError("suspicious_name", "The workbook contains an unsafe internal path.");
    }
    uncompressed += usize;
    compressed += csize;
    if (uncompressed > limits.maxUncompressedBytes) {
      throw new ZipGuardError("too_large", "The workbook expands to more data than is allowed.");
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }

  // Extreme compression ratios on non-trivial payloads are the zip-bomb signature.
  if (uncompressed > 8 * 1024 * 1024 && compressed > 0 && uncompressed / compressed > 200) {
    throw new ZipGuardError("too_large", "The workbook expands to more data than is allowed.");
  }
  return { entries, uncompressed };
}
