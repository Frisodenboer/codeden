import { type Dirent, existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import type { FsListResponse } from "@codeden/contracts";
import { badRequest, forbidden, notFound } from "../errors";

const MAX_ENTRIES = 2000;

/** Drive roots on Windows (probing `C:\` .. `Z:\`), `/` elsewhere. */
export function listRoots(platform: NodeJS.Platform = process.platform): FsListResponse["roots"] {
  if (platform !== "win32") return [{ name: "/", path: "/" }];
  const roots: FsListResponse["roots"] = [];
  for (let code = 67; code <= 90; code++) {
    const path = `${String.fromCharCode(code)}:\\`;
    if (existsSync(path)) roots.push({ name: path.slice(0, 2), path });
  }
  return roots;
}

/**
 * Server-side folder picker (§13): lists directories only, read-only. Without a path it
 * returns the home folder's contents plus the roots.
 */
export function listDirectories(
  requested: string | undefined,
  opts: { showHidden?: boolean; home?: string } = {},
): FsListResponse {
  const home = opts.home ?? homedir();
  const path = resolve(requested?.trim() ? requested : home);
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    throw notFound(`Folder not found: ${path}`, "folder_not_found");
  }
  if (!stat.isDirectory()) throw badRequest(`Not a folder: ${path}`, "not_a_folder");

  let dirents: Dirent[];
  try {
    dirents = readdirSync(path, { withFileTypes: true });
  } catch {
    throw forbidden(`Cannot read ${path}`, "folder_unreadable");
  }

  const entries: FsListResponse["entries"] = [];
  for (const d of dirents) {
    const full = join(path, d.name);
    let isDir = d.isDirectory();
    if (!isDir && d.isSymbolicLink()) {
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        isDir = false;
      }
    }
    if (!isDir) continue;
    const hidden =
      d.name.startsWith(".") || d.name === "$RECYCLE.BIN" || d.name === "System Volume Information";
    if (hidden && !opts.showHidden) continue;
    entries.push({ name: d.name, path: full, hidden, isGitRepo: existsSync(join(full, ".git")) });
    if (entries.length >= MAX_ENTRIES) break;
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  const isRoot = parse(path).root === path;
  return {
    path,
    parent: isRoot ? null : dirname(path),
    home,
    roots: listRoots(),
    entries,
    truncated: entries.length >= MAX_ENTRIES,
  };
}
