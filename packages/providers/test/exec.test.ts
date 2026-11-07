import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  quoteCmdArg,
  resolveExecutable,
  runCommand,
  scriptFromCmdShim,
  spawnArgs,
} from "../src/util/exec";
import { compareVersions, parseVersion } from "../src/util/version";

const NPM_SHIM = `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0
endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*
`;

const PNPM_SHIM = `@SETLOCAL
@IF EXIST "%~dp0\\node.exe" (
  "%~dp0\\node.exe"  "%~dp0\\global\\5\\node_modules\\tool\\dist\\cli.mjs" %*
) ELSE (
  node  "%~dp0\\global\\5\\node_modules\\tool\\dist\\cli.mjs" %*
)`;

describe("Windows shims", () => {
  it("extracts the script from npm and pnpm cmd shims", () => {
    expect(scriptFromCmdShim("C:\\npm\\codex.cmd", NPM_SHIM)).toBe(
      "C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
    );
    expect(scriptFromCmdShim("C:\\pnpm\\tool.cmd", PNPM_SHIM)).toBe(
      "C:\\pnpm\\global\\5\\node_modules\\tool\\dist\\cli.mjs",
    );
    expect(scriptFromCmdShim("C:\\x\\a.cmd", "@echo off\r\nfoo.exe %*")).toBeUndefined();
  });

  it("quotes cmd.exe arguments", () => {
    expect(quoteCmdArg("plain")).toBe("plain");
    expect(quoteCmdArg("has space")).toBe('"has space"');
    expect(quoteCmdArg('a"b')).toBe('"a^"b"');
    expect(quoteCmdArg("")).toBe('""');
  });

  it("runs node scripts with the current node", () => {
    const [file, args] = spawnArgs({ kind: "node-script", path: "x.cmd", script: "x.js" }, ["--v"]);
    expect(file).toBe(process.execPath);
    expect(args).toEqual(["x.js", "--v"]);
  });
});

describe("resolveExecutable", () => {
  it("finds executables on PATH with PATHEXT on Windows and classifies shims", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cd-exec-"));
    mkdirSync(path.join(dir, "node_modules", "@openai", "codex", "bin"), { recursive: true });
    writeFileSync(path.join(dir, "node_modules", "@openai", "codex", "bin", "codex.js"), "");
    writeFileSync(path.join(dir, "codex.cmd"), NPM_SHIM);
    writeFileSync(path.join(dir, "tool.exe"), "");
    writeFileSync(path.join(dir, "other.bat"), "@echo off");
    const opts = { pathEnv: dir, pathExt: ".EXE;.CMD;.BAT", platform: "win32" as const };
    if (process.platform === "win32") {
      expect(resolveExecutable("codex", opts)).toMatchObject({ kind: "node-script" });
      expect(resolveExecutable("tool", opts)).toMatchObject({ kind: "native" });
      expect(resolveExecutable("other", opts)).toMatchObject({ kind: "shell-script" });
    }
    expect(resolveExecutable("missing-tool-xyz", opts)).toBeUndefined();
  });

  it("runs a real command with a timeout", async () => {
    const node = { kind: "native" as const, path: process.execPath };
    const ok = await runCommand(node, ["-e", "console.log('v1.2.3')"]);
    expect(ok.code).toBe(0);
    expect(parseVersion(ok.stdout)).toBe("1.2.3");
    const slow = await runCommand(node, ["-e", "setTimeout(()=>{}, 5000)"], { timeoutMs: 200 });
    expect(slow.timedOut).toBe(true);
    const missing = await runCommand({ kind: "native", path: "/no/such/binary" }, []);
    expect(missing.error).toBeDefined();
  });
});

describe("versions", () => {
  it("parses and compares", () => {
    expect(parseVersion("2.1.318 (Claude Code)")).toBe("2.1.318");
    expect(parseVersion("codex-cli 0.160.1")).toBe("0.160.1");
    expect(compareVersions("2.1.318", "2.1.250")).toBeGreaterThan(0);
    expect(compareVersions("0.99.0", "0.160.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
});
