// Reading a zip in the Worker (M24.3): an archive upload, and the packages xlsx, pptx, ods and odp
// are. Caps on entry count, total uncompressed bytes and each entry's path are checked before an
// entry is inflated and again on what came out; a path that climbs out (`..`, absolute, a drive, a
// backslash) refuses the whole archive. fflate is pure JavaScript, so it runs in workerd as written.
import { unzipSync } from "fflate";

export const ZIP_MAX_ENTRIES = 500;
export const ZIP_MAX_BYTES = 50 * 1024 * 1024;
export const ZIP_MAX_DEPTH = 8;

export type ZipCode = "INGEST_ZIP_INVALID" | "INGEST_ZIP_TOO_MANY_ENTRIES" | "INGEST_ZIP_TOO_LARGE" | "INGEST_ZIP_PATH_REFUSED";
export type ZipResult = { ok: true; entries: Array<{ path: string; bytes: Uint8Array }> } | { ok: false; code: ZipCode; reason: string };

class Refused extends Error {
  readonly code: ZipCode;
  constructor(code: ZipCode, reason: string) {
    super(reason);
    this.code = code;
  }
}

/** An entry's path, or why it is refused: relative, forward slashes, no `..`, bounded depth. */
export function entryPathRefusal(name: string): string | null {
  if (name.includes("\\") || name.includes("\0")) return `entry ${JSON.stringify(name.slice(0, 80))} has a backslash or NUL in its path`;
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) return `entry ${JSON.stringify(name.slice(0, 80))} is an absolute path`;
  const parts = name.replace(/\/$/, "").split("/");
  if (parts.some((p) => p === ".." || p === ".")) return `entry ${JSON.stringify(name.slice(0, 80))} climbs out of the archive`;
  if (parts.length > ZIP_MAX_DEPTH) return `entry ${JSON.stringify(name.slice(0, 80))} is nested over ${ZIP_MAX_DEPTH} levels`;
  return null;
}

export function readZip(bytes: Uint8Array, caps: { entries?: number; bytes?: number } = {}): ZipResult {
  const maxEntries = caps.entries ?? ZIP_MAX_ENTRIES;
  const maxBytes = caps.bytes ?? ZIP_MAX_BYTES;
  let count = 0;
  let declared = 0;
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, {
      filter: (f) => {
        const refusal = entryPathRefusal(f.name);
        if (refusal) throw new Refused("INGEST_ZIP_PATH_REFUSED", refusal);
        if (f.name.endsWith("/")) return false;
        if (++count > maxEntries) throw new Refused("INGEST_ZIP_TOO_MANY_ENTRIES", `the archive holds over ${maxEntries} files`);
        declared += f.originalSize;
        if (declared > maxBytes) throw new Refused("INGEST_ZIP_TOO_LARGE", `the archive unpacks to over ${maxBytes} bytes`);
        return true;
      },
    });
  } catch (err) {
    if (err instanceof Refused) return { ok: false, code: err.code, reason: err.message };
    return { ok: false, code: "INGEST_ZIP_INVALID", reason: `not a readable zip: ${String(err instanceof Error ? err.message : err).slice(0, 120)}` };
  }
  // What came out is held to the cap too: a declared size is the archive's word, not a fact.
  const entries = Object.entries(files).map(([path, b]) => ({ path, bytes: b }));
  const total = entries.reduce((n, e) => n + e.bytes.byteLength, 0);
  if (total > maxBytes) return { ok: false, code: "INGEST_ZIP_TOO_LARGE", reason: `the archive unpacked to ${total} bytes, over ${maxBytes}` };
  return { ok: true, entries };
}

/** One entry as UTF-8 text, or null when the package has no such part. */
export function partText(entries: Array<{ path: string; bytes: Uint8Array }>, path: string): string | null {
  const e = entries.find((x) => x.path === path);
  return e ? new TextDecoder().decode(e.bytes) : null;
}
