import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { type E2eServer, startE2eServer } from "./support/server";

/**
 * First-run setup with a broken Claude Code install (§14): the only `claude` on PATH is a
 * leftover npm shim whose package was removed (Windows: `claude.cmd` and `claude.ps1`;
 * elsewhere: a dangling link). The checklist says so, with the paths, instead of failing to
 * read a login state. PATH is limited to the fake bin folder and the OS's own folders, so
 * a real `claude` on this machine cannot answer instead.
 */
const win = process.platform === "win32";
let server: E2eServer;
let fakeBin = "";

/** The leftover shims npm leaves behind when a global package is removed. */
function writeBrokenClaude(bin: string): void {
  mkdirSync(bin, { recursive: true });
  if (win) {
    writeFileSync(
      join(bin, "claude.cmd"),
      '@ECHO off\r\nSETLOCAL\r\nSET dp0=%~dp0\r\n"%dp0%\\node.exe"  "%dp0%\\node_modules\\@anthropic-ai\\claude-code\\cli.js" %*\r\n',
    );
    writeFileSync(
      join(bin, "claude.ps1"),
      '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent\n& "node$exe"  "$basedir/node_modules/@anthropic-ai/claude-code/cli.js" $args\n',
    );
    return;
  }
  symlinkSync("../lib/node_modules/@anthropic-ai/claude-code/cli.js", join(bin, "claude"));
}

/** Only the fake bin and the system folders (cmd.exe, reg.exe, taskkill; sh). */
function limitedPath(bin: string): string {
  if (!win) return [bin, "/usr/bin", "/bin"].join(":");
  const root = process.env.SystemRoot ?? "C:\\Windows";
  return [
    bin,
    join(root, "System32"),
    root,
    join(root, "System32", "WindowsPowerShell", "v1.0"),
  ].join(";");
}

test.describe("setup with a broken Claude Code install", () => {
  test.beforeAll(async () => {
    test.setTimeout(120_000);
    server = await startE2eServer({
      pinPath: true,
      env: (base, env) => {
        fakeBin = join(base, "fake-bin");
        writeBrokenClaude(fakeBin);
        const out: NodeJS.ProcessEnv = {};
        for (const [key, value] of Object.entries(env)) {
          if (key.toLowerCase() !== "path") out[key] = value;
        }
        return { ...out, PATH: limitedPath(fakeBin) };
      },
    });
  });

  test.afterAll(async () => {
    await server?.stop();
  });

  test("names the broken copies instead of a login error", async ({ page }) => {
    await page.goto(server.launchUrl);
    await expect(page).toHaveURL(/\/setup$/);
    const checklist = page.getByTestId("setup-checklist");
    await expect(checklist.getByText("Checking…")).toHaveCount(0, { timeout: 60_000 });
    const row = checklist.locator("[data-check=claude]");
    const shim = join(fakeBin, win ? "claude.cmd" : "claude");
    await expect(row).toContainText(`Claude Code is installed but broken: \`${shim}\``);
    await expect(row).toContainText(
      win ? "points at a missing package" : "points at a missing file",
    );
    await expect(row).toContainText("Reinstall it, or remove the leftover shim.");
    await expect(row).not.toContainText("Could not read the Claude login state");
    // The fix is a reinstall, not a sign-in.
    await expect(row.getByRole("button", { name: "Install", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "Sign in", exact: true })).toHaveCount(0);

    await row.getByText("Details").click();
    const details = row.getByTestId("check-details");
    await expect(details).toContainText(shim);
    await expect(details).toContainText(join("@anthropic-ai", "claude-code", "cli.js"));
    if (win) await expect(details).toContainText(join(fakeBin, "claude.ps1"));
  });
});
