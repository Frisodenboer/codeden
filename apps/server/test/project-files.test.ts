import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/services/errors";
import { applyProjectFileOp } from "../src/services/files/project-files";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codebench-project-files-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, ".git"));
  writeFileSync(join(dir, "src", "a.ts"), "export {};\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error instanceof ServiceError ? error.code : String(error);
  }
  return "no error";
};

describe("project file manager", () => {
  it("creates files and folders, including missing parents", () => {
    expect(applyProjectFileOp(dir, { op: "createFile", path: "docs/notes.md" })).toEqual({
      ok: true,
      path: "docs/notes.md",
    });
    expect(readFileSync(join(dir, "docs", "notes.md"), "utf8")).toBe("");
    applyProjectFileOp(dir, { op: "createDir", path: "assets/img" });
    expect(existsSync(join(dir, "assets", "img"))).toBe(true);
  });

  it("refuses to overwrite something that exists", () => {
    expect(code(() => applyProjectFileOp(dir, { op: "createFile", path: "src/a.ts" }))).toBe(
      "exists",
    );
    expect(code(() => applyProjectFileOp(dir, { op: "createDir", path: "src" }))).toBe("exists");
  });

  it("renames and moves, but not onto an existing name or into itself", () => {
    expect(applyProjectFileOp(dir, { op: "rename", from: "src/a.ts", to: "lib/b.ts" }).path).toBe(
      "lib/b.ts",
    );
    expect(readFileSync(join(dir, "lib", "b.ts"), "utf8")).toBe("export {};\n");
    writeFileSync(join(dir, "c.ts"), "");
    expect(
      code(() => applyProjectFileOp(dir, { op: "rename", from: "c.ts", to: "lib/b.ts" })),
    ).toBe("exists");
    expect(
      code(() => applyProjectFileOp(dir, { op: "rename", from: "lib", to: "lib/inner" })),
    ).toBe("move_into_self");
  });

  it("deletes files and folders", () => {
    applyProjectFileOp(dir, { op: "delete", path: "src" });
    expect(existsSync(join(dir, "src"))).toBe(false);
    expect(code(() => applyProjectFileOp(dir, { op: "delete", path: "src" }))).toBe(
      "file_not_found",
    );
  });

  it("never touches .git, the project folder itself or anything outside it", () => {
    expect(code(() => applyProjectFileOp(dir, { op: "delete", path: ".git" }))).toBe(
      "protected_path",
    );
    expect(code(() => applyProjectFileOp(dir, { op: "createFile", path: ".git/hooks/x" }))).toBe(
      "protected_path",
    );
    expect(code(() => applyProjectFileOp(dir, { op: "delete", path: "." }))).toBe("project_root");
    expect(code(() => applyProjectFileOp(dir, { op: "delete", path: "../outside" }))).toBe(
      "path_outside_root",
    );
    expect(existsSync(join(dir, ".git"))).toBe(true);
  });
});
