import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/services/errors";
import { listSessionFiles, readSessionFile } from "../src/services/files/session-files";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeden-session-files-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, ".git"));
  writeFileSync(join(dir, "src", ".git"), "gitdir: elsewhere\n");
  mkdirSync(join(dir, "node_modules", "x"), { recursive: true });
  writeFileSync(join(dir, "README.md"), "# hi\n");
  writeFileSync(join(dir, "src", "index.ts"), "export {};\n");
  writeFileSync(join(dir, "src", "blob.bin"), Buffer.from([1, 0, 2]));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("session files", () => {
  it("lists folders first and skips .git and node_modules", () => {
    const list = listSessionFiles(dir);
    expect(list.entries.map((e) => e.path)).toEqual([
      "src",
      "src/blob.bin",
      "src/index.ts",
      "README.md",
    ]);
    expect(list.truncated).toBe(false);
  });

  it("reads text files, flags binaries and stays inside the folder", () => {
    expect(readSessionFile(dir, "src/index.ts")).toMatchObject({
      content: "export {};\n",
      binary: false,
    });
    expect(readSessionFile(dir, "src/blob.bin").binary).toBe(true);
    let code = "";
    try {
      readSessionFile(dir, "../outside.txt");
    } catch (error) {
      code = error instanceof ServiceError ? error.code : String(error);
    }
    expect(code).toBe("path_outside_root");
  });
});
