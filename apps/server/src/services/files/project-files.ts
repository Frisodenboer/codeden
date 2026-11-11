import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { ProjectFileOp, ProjectFileOpResponse } from "@codeden/contracts";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { resolveInside } from "./path-guard";

/** Names that can't be created, renamed or deleted from the file manager. */
const PROTECTED = new Set([".git"]);

/** Resolve a path for a change: inside the project folder, not the folder itself, not in `.git`. */
function target(root: string, path: string): string {
  const absolute = resolveInside(root, path);
  const rel = relative(resolve(root), absolute);
  if (rel === "") throw forbidden("You can't change the project folder itself", "project_root");
  if (rel.split(/[\\/]/).some((part) => PROTECTED.has(part))) {
    throw forbidden("Files in .git can't be changed here", "protected_path");
  }
  return absolute;
}

const toSlash = (root: string, absolute: string) =>
  relative(resolve(root), absolute).replace(/\\/g, "/");

/** Apply one file manager change to a project's main checkout. */
export function applyProjectFileOp(root: string, op: ProjectFileOp): ProjectFileOpResponse {
  if (!existsSync(root)) throw notFound("The project folder no longer exists", "folder_not_found");
  switch (op.op) {
    case "createFile": {
      const path = target(root, op.path);
      if (existsSync(path)) throw conflict("Something with that name already exists", "exists");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, "", { flag: "wx" });
      return { ok: true, path: toSlash(root, path) };
    }
    case "createDir": {
      const path = target(root, op.path);
      if (existsSync(path)) throw conflict("Something with that name already exists", "exists");
      mkdirSync(path, { recursive: true });
      return { ok: true, path: toSlash(root, path) };
    }
    case "rename": {
      const from = target(root, op.from);
      const to = target(root, op.to);
      if (!existsSync(from)) throw notFound("No such file or folder", "file_not_found");
      if (existsSync(to)) throw conflict("Something with that name already exists", "exists");
      const rel = relative(from, to);
      if (rel && !rel.startsWith("..") && statSync(from).isDirectory()) {
        throw badRequest("A folder can't be moved into itself", "move_into_self");
      }
      mkdirSync(dirname(to), { recursive: true });
      renameSync(from, to);
      return { ok: true, path: toSlash(root, to) };
    }
    case "delete": {
      const path = target(root, op.path);
      if (!existsSync(path)) throw notFound("No such file or folder", "file_not_found");
      rmSync(path, { recursive: true, force: false });
      return { ok: true, path: toSlash(root, path) };
    }
  }
}
