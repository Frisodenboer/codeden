import { gunzipSync } from "node:zlib";

const BLOCK = 512;

function field(header: Buffer, start: number, length: number): string {
  const raw = header.subarray(start, start + length).toString("utf8");
  const nul = raw.indexOf("\0");
  return nul === -1 ? raw : raw.slice(0, nul);
}

/**
 * Read one regular file out of a gzipped tar archive (an npm package tarball). Only the
 * named entry is returned, so nothing in the archive decides where files are written.
 */
export function extractTgzEntry(archive: Uint8Array, entry: string): Buffer {
  const tar = gunzipSync(archive);
  let offset = 0;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    const name = field(header, 0, 100);
    if (!name) break; // two zero blocks end the archive
    const size = Number.parseInt(field(header, 124, 12).trim() || "0", 8);
    if (!Number.isFinite(size) || size < 0) throw new Error("Corrupt archive header");
    const type = String.fromCharCode(header[156] ?? 0);
    const prefix = field(header, 257, 6).startsWith("ustar") ? field(header, 345, 155) : "";
    const path = prefix ? `${prefix}/${name}` : name;
    const start = offset + BLOCK;
    if ((type === "0" || type === "\0") && path === entry) {
      if (start + size > tar.length) throw new Error("Archive is truncated");
      return Buffer.from(tar.subarray(start, start + size));
    }
    offset = start + Math.ceil(size / BLOCK) * BLOCK;
  }
  throw new Error(`${entry} is not in the archive`);
}
