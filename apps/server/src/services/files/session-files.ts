import {
  closeSync,
  type Dirent,
  existsSync,
  openSync,
  readdirSync,
  readSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import type { SessionFileContent, SessionFileEntry, SessionFileList } from "@codeden/contracts";
import { badRequest, notFound } from "../errors";
import { resolveInside } from "./path-guard";

const MAX_ENTRIES = 5000;
const MAX_READ_BYTES = 1024 * 1024;
const SKIP = new Set([".git", "node_modules"]);

/**
 * List a session's working directory for the files panel (§12.3): depth-first, folders
 * first, `.git` and `node_modules` skipped, capped at 5000 entries. Symlinks are listed but
 * not followed.
 */
export function listSessionFiles(root: string): SessionFileList {
  if (!existsSync(root)) throw notFound("The session folder no longer exists", "folder_not_found");
  const entries: SessionFileEntry[] = [];
  let truncated = false;
  const walk = (dir: string, prefix: string) => {
    let dirents: Dirent[];
    try {
      dirents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    dirents.sort((a, b) =>
      a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
    );
    for (const d of dirents) {
      if (entries.length >= MAX_ENTRIES) {
        truncated = true;
        return;
      }
      if (d.isDirectory() && SKIP.has(d.name)) continue;
      const path = prefix ? `${prefix}/${d.name}` : d.name;
      if (d.isDirectory()) {
        entries.push({ path, kind: "dir" });
        walk(join(dir, d.name), path);
      } else {
        let sizeBytes: number | undefined;
        try {
          sizeBytes = statSync(join(dir, d.name)).size;
        } catch {
          sizeBytes = undefined;
        }
        entries.push({ path, kind: "file", ...(sizeBytes === undefined ? {} : { sizeBytes }) });
      }
    }
  };
  walk(root, "");
  return { root, entries, truncated };
}

/** Read one file (first 1 MB) from a session's working directory, inside the path guard. */
export function readSessionFile(root: string, path: string): SessionFileContent {
  const absolute = resolveInside(root, path);
  if (!existsSync(absolute)) throw notFound("No such file", "file_not_found");
  const stat = statSync(absolute);
  if (!stat.isFile()) throw badRequest("Not a file", "not_a_file");
  const length = Math.min(stat.size, MAX_READ_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = openSync(absolute, "r");
  try {
    readSync(fd, buffer, 0, length, 0);
  } finally {
    closeSync(fd);
  }
  const binary = buffer.subarray(0, 8000).includes(0);
  return {
    path: path.replace(/\\/g, "/"),
    content: binary ? "" : buffer.toString("utf8"),
    sizeBytes: stat.size,
    binary,
    truncated: stat.size > MAX_READ_BYTES,
  };
}
