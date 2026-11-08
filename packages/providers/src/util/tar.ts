import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";

const BLOCK = 512;

/**
 * Extract a gzipped tarball (an npm package) into `dest`, dropping the first `strip` path
 * components (`package/` in npm tarballs). Only regular files and directories are written;
 * links and devices are skipped. Entries that would land outside `dest` (absolute paths,
 * `..`) fail the whole extraction. Returns the relative paths written.
 */
export function extractTarGz(archive: Buffer, dest: string, opts: { strip?: number } = {}) {
  const tar = gunzipSync(archive);
  const root = path.resolve(dest);
  const written: string[] = [];
  let offset = 0;
  let longName: string | null = null;
  let paxPath: string | null = null;
  while (offset + BLOCK <= tar.length) {
    const header = tar.subarray(offset, offset + BLOCK);
    if (header.every((b) => b === 0)) break;
    if (!checksumOk(header)) throw new Error("Corrupt tarball (bad header checksum)");
    const size = readOctal(header, 124, 12);
    const type = String.fromCharCode(header[156] ?? 0);
    const dataStart = offset + BLOCK;
    const data = tar.subarray(dataStart, dataStart + size);
    if (data.length < size) throw new Error("Corrupt tarball (truncated entry)");
    offset = dataStart + Math.ceil(size / BLOCK) * BLOCK;

    if (type === "L") {
      longName = cString(data);
      continue;
    }
    if (type === "x") {
      paxPath = paxRecord(data, "path");
      continue;
    }
    if (type === "g") continue;
    const name = paxPath ?? longName ?? headerName(header);
    longName = null;
    paxPath = null;
    const isFile = type === "0" || type === "\0" || type === "7";
    if (!isFile && type !== "5") continue;

    const rel = stripComponents(name, opts.strip ?? 0);
    if (!rel) continue;
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Unsafe path in tarball: ${name}`);
    }
    if (type === "5") {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
    written.push(rel);
  }
  return written;
}

function stripComponents(name: string, strip: number): string | null {
  const parts = name.replace(/\\/g, "/").split("/").filter(Boolean);
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw new Error(`Unsafe path in tarball: ${name}`);
  }
  if (parts.includes("..")) throw new Error(`Unsafe path in tarball: ${name}`);
  const rest = parts.slice(strip).filter((p) => p !== ".");
  return rest.length ? rest.join("/") : null;
}

function headerName(header: Buffer): string {
  const name = cString(header.subarray(0, 100));
  const magic = header.subarray(257, 263).toString("latin1");
  if (!magic.startsWith("ustar")) return name;
  const prefix = cString(header.subarray(345, 500));
  return prefix ? `${prefix}/${name}` : name;
}

function cString(buf: Buffer): string {
  const end = buf.indexOf(0);
  return buf.subarray(0, end === -1 ? buf.length : end).toString("utf8");
}

function readOctal(buf: Buffer, start: number, length: number): number {
  const text = cString(buf.subarray(start, start + length)).trim();
  const value = text ? Number.parseInt(text, 8) : 0;
  if (!Number.isFinite(value) || value < 0) throw new Error("Corrupt tarball (bad size)");
  return value;
}

function checksumOk(header: Buffer): boolean {
  const expected = readOctal(header, 148, 8);
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : (header[i] ?? 0);
  return sum === expected;
}

/** One `key=value` record from a pax extended header (`<len> <key>=<value>\n` lines). */
function paxRecord(data: Buffer, key: string): string | null {
  // Lengths count bytes, so parse the buffer rather than a decoded string.
  let i = 0;
  while (i < data.length) {
    const space = data.indexOf(0x20, i);
    if (space === -1) break;
    const len = Number.parseInt(data.subarray(i, space).toString("latin1"), 10);
    if (!Number.isFinite(len) || len <= 0) break;
    const record = data.subarray(space + 1, i + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq !== -1 && record.slice(0, eq) === key) return record.slice(eq + 1);
    i += len;
  }
  return null;
}
