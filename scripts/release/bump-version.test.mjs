import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bumpRepository,
  nextVersion,
  releaseChangelog,
  setPackageVersion,
  setSourceVersion,
} from "./bump-version.mjs";

describe("nextVersion", () => {
  it("bumps patch, minor and major", () => {
    expect(nextVersion("0.4.0", "patch")).toBe("0.4.1");
    expect(nextVersion("0.4.9", "minor")).toBe("0.5.0");
    expect(nextVersion("0.4.9", "major")).toBe("1.0.0");
  });

  it("rejects unknown bumps and pre-release versions", () => {
    expect(() => nextVersion("0.4.0", "dry-run")).toThrow(/Unknown bump/);
    expect(() => nextVersion("0.4.0-beta.1", "patch")).toThrow(/x\.y\.z/);
  });
});

describe("file edits", () => {
  it("replaces only the version field of a package.json", () => {
    const text = '{\n  "name": "codeden",\n  "version": "0.4.0",\n  "dependencies": {}\n}\n';
    expect(setPackageVersion(text, "0.4.1")).toBe(text.replace("0.4.0", "0.4.1"));
  });

  it("replaces SOURCE_VERSION", () => {
    const text = 'export const SOURCE_VERSION = "0.4.0";\nexport const X = "0.4.0";\n';
    expect(setSourceVersion(text, "0.4.1")).toBe(
      'export const SOURCE_VERSION = "0.4.1";\nexport const X = "0.4.0";\n',
    );
  });

  it("moves the unreleased notes under the new version", () => {
    const text =
      "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- A bug.\n\n## [0.4.0] - 2026-11-08\n\n- Old.\n";
    expect(releaseChangelog(text, "0.4.1", "2026-11-09")).toBe(
      "# Changelog\n\n## [Unreleased]\n\n## [0.4.1] - 2026-11-09\n\n### Fixed\n\n- A bug.\n\n## [0.4.0] - 2026-11-08\n\n- Old.\n",
    );
  });

  it("still adds a version section when nothing is unreleased", () => {
    const text = "# Changelog\n\n## [Unreleased]\n\n## [0.4.0] - 2026-11-08\n\n- Old.\n";
    expect(releaseChangelog(text, "0.4.1", "2026-11-09")).toContain(
      "## [Unreleased]\n\n## [0.4.1] - 2026-11-09\n\nMaintenance release.\n\n## [0.4.0]",
    );
  });
});

describe("bumpRepository", () => {
  let root = "";
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  function makeRepo(cli, desktop) {
    root = mkdtempSync(join(tmpdir(), "codeden-bump-"));
    for (const dir of ["apps/cli", "apps/desktop", "packages/contracts/src"]) {
      mkdirSync(join(root, dir), { recursive: true });
    }
    writeFileSync(join(root, "apps/cli/package.json"), `{\n  "version": "${cli}"\n}\n`);
    writeFileSync(join(root, "apps/desktop/package.json"), `{\n  "version": "${desktop}"\n}\n`);
    writeFileSync(
      join(root, "packages/contracts/src/version.ts"),
      `export const SOURCE_VERSION = "${cli}";\n`,
    );
    writeFileSync(join(root, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n- New.\n");
  }

  it("writes the new version to every file", () => {
    makeRepo("0.4.0", "0.4.0");
    expect(bumpRepository(root, "minor", "2026-11-09")).toBe("0.5.0");
    const read = (path) => readFileSync(join(root, path), "utf8");
    expect(JSON.parse(read("apps/cli/package.json")).version).toBe("0.5.0");
    expect(JSON.parse(read("apps/desktop/package.json")).version).toBe("0.5.0");
    expect(read("packages/contracts/src/version.ts")).toContain('"0.5.0"');
    expect(read("CHANGELOG.md")).toContain("## [0.5.0] - 2026-11-09\n\n- New.");
  });

  it("refuses when the CLI and desktop versions disagree", () => {
    makeRepo("0.4.0", "0.3.0");
    expect(() => bumpRepository(root, "patch")).toThrow(/apps\/desktop is 0.3.0/);
  });
});
