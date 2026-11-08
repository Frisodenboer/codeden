import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CLAUDE_SDK_PACKAGE,
  CLAUDE_SDK_VERSION,
  chooseInstaller,
  importClaudeSdkFrom,
  installClaudeSdk,
  isClaudeSdkInstalled,
} from "../src/claude/sdk";
import type { ResolvedCommand } from "../src/util/exec";
import { installFromRegistry, registryUrl, sha512Of } from "../src/util/registry-install";
import { extractTarGz } from "../src/util/tar";
import {
  type FakeNpmRegistry,
  fakeSdkTarball,
  makeTarball,
  startFakeNpmRegistry,
} from "./support/fake-npm-registry";

let registry: FakeNpmRegistry;
const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

beforeAll(async () => {
  registry = await startFakeNpmRegistry();
  registry.publish(
    CLAUDE_SDK_PACKAGE,
    CLAUDE_SDK_VERSION,
    fakeSdkTarball(CLAUDE_SDK_PACKAGE, CLAUDE_SDK_VERSION),
  );
});

afterAll(async () => {
  await registry.close();
});

describe("Claude SDK install without npm (the desktop app)", () => {
  it("downloads the pinned tarball, checks its sha512 integrity and imports it", async () => {
    const dir = temp("codeden-deps-registry-");
    const lines: string[] = [];
    await installClaudeSdk({
      depsDir: dir,
      installer: "registry",
      registry: registry.url,
      onProgress: (l) => lines.push(l),
    });
    expect(isClaudeSdkInstalled(dir)).toBe(true);
    const sdk = (await importClaudeSdkFrom(dir)) as unknown as { query: () => string };
    expect(sdk.query()).toBe("from-registry");
    // Long paths (pax headers) are unpacked too.
    const deep = join(dir, "node_modules", ...CLAUDE_SDK_PACKAGE.split("/"), "deep");
    expect(existsSync(deep)).toBe(true);
    // Recorded in <deps>/package.json like `npm install --save-exact`.
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    expect(pkg.dependencies[CLAUDE_SDK_PACKAGE]).toBe(CLAUDE_SDK_VERSION);
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Downloading"),
        expect.stringContaining("Installed"),
      ]),
    );
    // Only the exact version was asked for: no optional platform packages, no peers.
    const asked = registry.requests.filter((r) => !r.endsWith(".tgz"));
    expect(asked.every((r) => r.includes(`claude-agent-sdk/${CLAUDE_SDK_VERSION}`))).toBe(true);
    expect(existsSync(join(dir, ".install.lock"))).toBe(false);
  });

  it("refuses a download that does not match the published integrity", async () => {
    const other = await startFakeNpmRegistry();
    try {
      other.publish(
        CLAUDE_SDK_PACKAGE,
        CLAUDE_SDK_VERSION,
        fakeSdkTarball(CLAUDE_SDK_PACKAGE, CLAUDE_SDK_VERSION),
        { integrity: `sha512-${Buffer.alloc(64).toString("base64")}` },
      );
      const dir = temp("codeden-deps-tampered-");
      await expect(
        installClaudeSdk({ depsDir: dir, installer: "registry", registry: other.url }),
      ).rejects.toThrow(/does not match its published integrity/);
      expect(isClaudeSdkInstalled(dir)).toBe(false);
      expect(existsSync(join(dir, ".install.lock"))).toBe(false);
    } finally {
      await other.close();
    }
  });

  it("reports a missing version", async () => {
    await expect(
      installFromRegistry({
        name: CLAUDE_SDK_PACKAGE,
        version: "0.0.0-missing",
        nodeModules: join(temp("codeden-deps-missing-"), "node_modules"),
        registry: registry.url,
      }),
    ).rejects.toThrow(/answered 404/);
  });

  it("uses the registry when told to or when no npm is found, npm otherwise", () => {
    const npm: ResolvedCommand = { kind: "native", path: "npm" };
    expect(chooseInstaller({ installer: "registry", npm })).toEqual({ kind: "registry" });
    expect(chooseInstaller({ npm }, { CODEDEN_DEPS_INSTALLER: "registry" })).toEqual({
      kind: "registry",
    });
    expect(chooseInstaller({ npm }, {})).toEqual({ kind: "npm", npm });
    expect(chooseInstaller({ npm, installer: "npm" }, {})).toEqual({ kind: "npm", npm });
  });

  it("reads registry URLs and integrity strings", () => {
    expect(registryUrl(undefined, {})).toBe("https://registry.npmjs.org");
    expect(registryUrl(undefined, { npm_config_registry: "https://r.example/" })).toBe(
      "https://r.example",
    );
    expect(sha512Of("sha1-abc sha512-XYZ==")).toBe("XYZ==");
    expect(sha512Of("sha1-abc")).toBeNull();
  });
});

describe("tarball extraction", () => {
  it("rejects entries that escape the target folder", () => {
    for (const path of ["package/../../evil.txt", "/etc/passwd", "C:/evil.txt"]) {
      const archive = makeTarball([{ path, data: "x" }]);
      expect(() => extractTarGz(archive, temp("codeden-tar-"), { strip: 1 }), path).toThrow(
        /Unsafe path/,
      );
    }
  });

  it("skips links and writes files and folders", () => {
    const dest = temp("codeden-tar-ok-");
    const written = extractTarGz(
      makeTarball([
        { path: "package/lib", type: "5" },
        { path: "package/lib/a.js", data: "a" },
        { path: "package/link", type: "2" },
      ]),
      dest,
      { strip: 1 },
    );
    expect(written).toEqual(["lib/a.js"]);
    expect(readFileSync(join(dest, "lib", "a.js"), "utf8")).toBe("a");
    expect(existsSync(join(dest, "link"))).toBe(false);
  });
});
