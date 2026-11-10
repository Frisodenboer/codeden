import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commandLineNamesInside,
  type ProcessRow,
  pathIsInside,
  processesToEnd,
  startedByAgents,
} from "../src/process/inside";
import { ProcessSupervisor } from "../src/process/supervisor";
import { parseLsofCwds, parsePsTable, parseWindowsTable } from "../src/process/table";
import { endProcessesInside } from "../src/process/worktree-processes";
import { removeWorkspace } from "../src/workspace/removal";
import { emptyTrash } from "../src/workspace/trash";
import { prepareWorkspace } from "../src/workspace/worktree";
import { makeRepo, removeDir, tempDir, waitUntil } from "./helpers";

const WT = "C:\\Users\\me\\.codeden\\wt\\demo\\abcd1234";

describe("matching a worktree path", () => {
  it("matches the folder and what is inside it, never a sibling with the same prefix", () => {
    expect(pathIsInside(WT, `${WT}\\node_modules\\x.exe`, true)).toBe(true);
    expect(pathIsInside(WT, "c:/users/ME/.codeden/wt/demo/abcd1234", true)).toBe(true);
    expect(pathIsInside(WT, `${WT}-2\\x.exe`, true)).toBe(false);
    expect(pathIsInside(WT, "C:\\Users\\me\\.codeden\\wt\\demo", true)).toBe(false);
    expect(pathIsInside("/home/me/wt/abcd", "/home/me/wt/abcd/src", false)).toBe(true);
    expect(pathIsInside("/home/me/wt/abcd", "/home/me/wt/ABCD/src", false)).toBe(false);
  });

  it("finds paths inside the folder on a command line, as whole paths", () => {
    const inside = (line: string) => commandLineNamesInside(WT, line, true);
    expect(inside(`"C:\\nodejs\\node.exe" ${WT}\\node_modules\\vite\\bin\\vite.js`)).toBe(true);
    expect(inside(`node "${WT}\\server.js" --port 5173`)).toBe(true);
    expect(inside(`node --config=${WT.toLowerCase()}/vite.config.ts`)).toBe(true);
    // Git Bash spelling.
    expect(inside("bash -c 'node /c/Users/me/.codeden/wt/demo/abcd1234/server.js'")).toBe(true);
    // The folder itself (an editor opened on it), a sibling, or a longer path that contains it.
    expect(inside(`"C:\\Code\\Code.exe" "${WT}"`)).toBe(false);
    expect(inside(`"C:\\Code\\Code.exe" ${WT}\\ --new-window`)).toBe(false);
    expect(inside(`node ${WT}-2\\server.js`)).toBe(false);
    expect(inside(`node D:\\backup\\${WT}\\server.js`)).toBe(false);
    expect(inside("node C:\\Users\\me\\other\\server.js")).toBe(false);
    expect(
      commandLineNamesInside("/home/me/wt/abcd", "node /mnt/home/me/wt/abcd/x.js", false),
    ).toBe(false);
    expect(commandLineNamesInside("/home/me/wt/abcd", "node /home/me/wt/abcd/x.js", false)).toBe(
      true,
    );
  });
});

const row = (pid: number, ppid: number, extra: Partial<ProcessRow> = {}): ProcessRow => ({
  pid,
  ppid,
  exe: null,
  commandLine: null,
  cwd: null,
  startedAt: 1000,
  ...extra,
});

describe("choosing which processes to end", () => {
  const RUNNER = 10;
  const SERVER = 20;
  const script = `node ${WT}\\server.js`;
  const rows: ProcessRow[] = [
    row(1, 0, { startedAt: 0 }), // the system
    row(5, 1, { startedAt: 0 }), // the user's desktop shell
    row(6, 5, { commandLine: `"C:\\Code\\Code.exe" ${WT}\\src\\app.ts` }), // the user's editor
    row(7, 5, { startedAt: 2000 }), // the user's terminal, started later
    row(8, 7, { commandLine: script, startedAt: 2000 }), // the user's own dev server
    row(19, 7, { commandLine: `node ${WT}\\cli.js`, startedAt: 2000 }), // CodeDen's CLI
    row(SERVER, 19, { startedAt: 2000 }),
    row(RUNNER, 99, { startedAt: 1500 }), // detached: its parent is gone
    row(30, RUNNER, { startedAt: 3000 }), // an agent CLI
    row(31, 30, { exe: `${WT}\\node_modules\\@esbuild\\win32-x64\\esbuild.exe`, startedAt: 3000 }),
    row(40, 98, { startedAt: 4000 }), // an agent's shell, orphaned when its CLI exited
    row(41, 40, { commandLine: script, startedAt: 4000 }), // ... and its dev server
    row(50, 97, { commandLine: script, startedAt: 500 }), // orphaned before the runner started
    row(60, 61, { commandLine: script, startedAt: 5000 }), // pid 61 was reused after it exited
    row(61, 5, { startedAt: 6000 }),
    row(70, RUNNER, { commandLine: `node ${WT}-2\\server.js`, startedAt: 3000 }), // a sibling
  ];

  it("ends only what CodeDen's agents started inside the worktree", () => {
    const allowed = startedByAgents(rows, RUNNER, 1500);
    expect([...allowed].sort((a, b) => a - b)).toEqual([30, 31, 40, 41, 60, 70]);
    const ended = processesToEnd({
      dir: WT,
      rows,
      windows: true,
      protect: [RUNNER, SERVER],
      allowed,
    });
    expect(ended.sort((a, b) => a - b)).toEqual([31, 41, 60]);
  });

  it("never ends CodeDen itself or one of its ancestors, and spares the user's terminals", () => {
    const allowed = new Set(rows.map((r) => r.pid));
    const ended = processesToEnd({
      dir: WT,
      rows,
      windows: true,
      protect: [RUNNER, SERVER],
      allowed,
      spare: new Set([41]),
    });
    // 19 (the CLI that started the server) names a file inside, but ending it would end CodeDen.
    expect(ended.sort((a, b) => a - b)).toEqual([6, 8, 31, 50, 60]);
  });
});

describe("reading the process table", () => {
  it("parses the Windows, ps and lsof formats", () => {
    expect(
      parseWindowsTable(
        JSON.stringify([
          { p: 4, pp: 0, e: null, c: null, t: null },
          { p: 900, pp: 4, e: "C:\\x.exe", c: "x --y", t: "2026-11-10T10:00:00.1234567Z" },
        ]),
      ),
    ).toEqual([
      { pid: 4, ppid: 0, exe: null, commandLine: null, cwd: null, startedAt: null },
      {
        pid: 900,
        ppid: 4,
        exe: "C:\\x.exe",
        commandLine: "x --y",
        cwd: null,
        startedAt: Date.parse("2026-11-10T10:00:00.123Z"),
      },
    ]);
    expect(parseWindowsTable(JSON.stringify({ p: 1, pp: 0 }))).toHaveLength(1);
    expect(parseWindowsTable("")).toEqual([]);
    expect(
      parsePsTable("  501   1 Tue Nov 10 17:00:00 2026     node /w/server.js --port 1\n"),
    ).toEqual([
      {
        pid: 501,
        ppid: 1,
        exe: null,
        commandLine: "node /w/server.js --port 1",
        cwd: null,
        startedAt: Date.parse("Tue Nov 10 17:00:00 2026"),
      },
    ]);
    expect([...parseLsofCwds("p1\nfcwd\nn/\np42\nfcwd\nn/home/me/wt/a\n")]).toEqual([
      [1, "/"],
      [42, "/home/me/wt/a"],
    ]);
  });
});

describe("removing a worktree an agent's dev server still runs in", () => {
  const dirs: string[] = [];
  const homes: string[] = [];
  afterEach(async () => {
    await Promise.all(homes.splice(0).map((home) => emptyTrash(home)));
    for (const dir of dirs.splice(0).reverse()) removeDir(dir);
  });

  it("ends the process (not one in a sibling folder) and then removes the worktree", async () => {
    const repo = makeRepo();
    const home = tempDir("codeden-home-");
    dirs.push(repo, home);
    homes.push(home);
    const ctx = { home, supervisor: new ProcessSupervisor(), emit: () => undefined };
    const wt = await prepareWorkspace(
      {
        name: "workspace.prepare",
        sessionId: "sess-leftover",
        repoPath: repo,
        strategy: "worktree",
        projectSlug: "demo",
        setupCommands: [],
      },
      ctx,
    );
    const hold = "setInterval(() => {}, 1000)";
    writeFileSync(join(wt.cwd, "server.js"), hold);
    const sibling = `${wt.cwd}-2`;
    mkdirSync(sibling);
    dirs.push(sibling);
    writeFileSync(join(sibling, "server.js"), hold);
    // Started outside the runner's tracking, working in the worktree (Windows then refuses
    // to move the folder).
    const start = (cwd: string) => {
      const child = spawn(process.execPath, [join(cwd, "server.js")], { cwd, stdio: "ignore" });
      const state = { exited: false };
      child.once("exit", () => {
        state.exited = true;
      });
      return { child, state };
    };
    const server = start(wt.cwd);
    const other = start(sibling);
    try {
      const ended = await endProcessesInside(wt.cwd, { home });
      expect(ended).toContain(server.child.pid);
      expect(ended).not.toContain(other.child.pid);
      await waitUntil(() => server.state.exited, 15_000);
      expect(other.state.exited).toBe(false);

      const removed = await removeWorkspace(
        { name: "workspace.remove", repoPath: repo, path: wt.cwd, force: true },
        home,
      );
      expect(removed).toMatchObject({ removed: true });
      expect(existsSync(wt.cwd)).toBe(false);
    } finally {
      server.child.kill();
      other.child.kill();
      await waitUntil(() => server.state.exited && other.state.exited, 15_000);
    }
  }, 60_000);
});
