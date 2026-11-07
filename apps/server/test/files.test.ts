import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/services/errors";
import { ConfigFiles } from "../src/services/files/config-files";
import { listDirectories, listRoots } from "../src/services/files/fs-browser";
import { resolveInside } from "../src/services/files/path-guard";
import type { ProjectService } from "../src/services/projects/project-service";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeden-files-"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

const code = (fn: () => unknown) => {
  try {
    fn();
    return "ok";
  } catch (error) {
    return error instanceof ServiceError ? error.code : String(error);
  }
};

describe("path guard", () => {
  it("allows paths inside the root and rejects escapes", () => {
    expect(resolveInside(dir, "a/b.txt")).toBe(join(dir, "a", "b.txt"));
    expect(code(() => resolveInside(dir, "../x"))).toBe("path_outside_root");
    expect(code(() => resolveInside(dir, "a/../../x"))).toBe("path_outside_root");
    expect(code(() => resolveInside(dir, join(tmpdir(), "elsewhere")))).toBe("path_outside_root");
    expect(code(() => resolveInside(dir, "a\0b"))).toBe("path_outside_root");
    expect(code(() => resolveInside(join(dir, "root"), join(dir, "rootless", "x")))).toBe(
      "path_outside_root",
    );
  });

  it("rejects backslash traversal, other drives, UNC and device paths", () => {
    // On POSIX a backslash is an ordinary file-name character, so those names stay inside.
    const cases = ["//server/share/x", "a/../../x"];
    if (process.platform === "win32") {
      const other = dir.slice(0, 1).toUpperCase() === "Z" ? "Y" : "Z";
      cases.push(
        "..\\x",
        "a\\..\\..\\x",
        "a/..\\../x",
        "\\\\server\\share\\x",
        `${other}:\\x`,
        `${other}:x`,
        "\\\\.\\pipe\\codeden",
        "\\\\?\\C:\\Windows",
      );
    } else {
      cases.push("/etc/passwd");
    }
    for (const p of cases)
      expect([p, code(() => resolveInside(dir, p))]).toEqual([p, "path_outside_root"]);
    // A name that merely starts with dots stays inside.
    expect(resolveInside(dir, "..notes.md")).toBe(join(dir, "..notes.md"));
  });

  it("follows symlinks out of the root", () => {
    const root = join(dir, "root");
    const outside = join(dir, "outside");
    mkdirSync(root);
    mkdirSync(outside);
    try {
      symlinkSync(outside, join(root, "link"), "junction");
    } catch {
      return; // symlinks not permitted on this machine
    }
    expect(code(() => resolveInside(root, "link/secret.txt"))).toBe("path_outside_root");
  });
});

describe("folder picker", () => {
  it("lists directories only, hides dot folders, marks git repos", () => {
    mkdirSync(join(dir, "app", ".git"), { recursive: true });
    mkdirSync(join(dir, "Beta"));
    mkdirSync(join(dir, ".hidden"));
    writeFileSync(join(dir, "file.txt"), "x");
    const listing = listDirectories(dir, { home: dir });
    expect(listing.entries.map((e) => e.name)).toEqual(["app", "Beta"]);
    expect(listing.entries[0]?.isGitRepo).toBe(true);
    expect(listing.parent).not.toBeNull();
    expect(listDirectories(dir, { showHidden: true }).entries.map((e) => e.name)).toContain(
      ".hidden",
    );
    expect(listDirectories(undefined, { home: dir }).path).toBe(dir);
    expect(code(() => listDirectories(join(dir, "nope")))).toBe("folder_not_found");
    expect(code(() => listDirectories(join(dir, "file.txt")))).toBe("not_a_folder");
    expect(listRoots("linux")).toEqual([{ name: "/", path: "/" }]);
    if (process.platform === "win32") expect(listRoots().length).toBeGreaterThan(0);
  });
});

describe("config files", () => {
  const projectPath = () => join(dir, "proj");
  const files = () =>
    new ConfigFiles({
      projects: { get: () => ({ path: projectPath() }) } as unknown as ProjectService,
      home: join(dir, "home"),
      backupDir: join(dir, "backups"),
    });

  beforeEach(() => {
    mkdirSync(projectPath());
    mkdirSync(join(dir, "home", ".claude"), { recursive: true });
    writeFileSync(join(dir, "home", ".claude", ".credentials.json"), "{}");
  });

  it("reads missing files as empty, writes atomically with backups and concurrency checks", () => {
    const f = files();
    const missing = f.read({ root: "project", projectId: "p", path: "CLAUDE.md" });
    expect(missing).toMatchObject({ exists: false, sha256: null, content: "" });

    const created = f.write({
      root: "project",
      projectId: "p",
      path: "CLAUDE.md",
      content: "# Hi",
      expectedSha256: null,
    });
    expect(created).toMatchObject({ exists: true, content: "# Hi", path: "CLAUDE.md" });

    expect(
      code(() =>
        f.write({
          root: "project",
          projectId: "p",
          path: "CLAUDE.md",
          content: "x",
          expectedSha256: null,
        }),
      ),
    ).toBe("file_changed");
    f.write({
      root: "project",
      projectId: "p",
      path: "CLAUDE.md",
      content: "# Two",
      expectedSha256: created.sha256,
    });
    expect(readdirSync(join(dir, "backups"))).toHaveLength(1);

    const nested = f.write({ root: "claude", path: "agents/reviewer.md", content: "agent" });
    expect(nested.absolutePath).toBe(join(dir, "home", ".claude", "agents", "reviewer.md"));
  });

  it("blocks credential files, .git and escapes", () => {
    const f = files();
    expect(code(() => f.read({ root: "claude", path: ".credentials.json" }))).toBe("path_blocked");
    expect(code(() => f.read({ root: "codex", path: "AUTH.json" }))).toBe("path_blocked");
    expect(
      code(() => f.write({ root: "project", projectId: "p", path: ".git/config", content: "" })),
    ).toBe("path_blocked");
    expect(code(() => f.read({ root: "project", projectId: "p", path: "../outside.txt" }))).toBe(
      "path_outside_root",
    );
    expect(code(() => f.read({ root: "project", path: "x" }))).toBe("project_required");
    writeFileSync(join(projectPath(), "bin.dat"), Buffer.from([1, 0, 2]));
    expect(code(() => f.read({ root: "project", projectId: "p", path: "bin.dat" }))).toBe(
      "binary_file",
    );
  });
});
