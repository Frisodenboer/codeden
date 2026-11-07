import type { CodeDenClient } from "../client";
import type { DiffResult, SetupStatus } from "../types";
import { mockBrowser, mockTerminal } from "./channels";
import { configContents, mcpServers, memoryFiles, skills, subagents } from "./fixtures/config";
import { ciFailureShot, contrastComparison, generatedIllustration } from "./fixtures/images";
import { listDir, setupChecks } from "./fixtures/ops";
import {
  allPaths,
  fileContents,
  fileTree,
  prDetails,
  sessionDiffs,
  slashCommands,
} from "./fixtures/workbench";
import type { MockWorld } from "./world";

const delay = <T>(value: T, ms = 120): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));

const artifacts: Record<string, () => string> = {
  "art-ci-shot": ciFailureShot,
  "art-contrast": contrastComparison,
  "art-hero": () => generatedIllustration(1),
};

type WorkbenchApi = Pick<
  CodeDenClient,
  | "getSetupStatus"
  | "recheckSetup"
  | "completeSetup"
  | "listDirectory"
  | "getDiff"
  | "listFiles"
  | "readFile"
  | "getPrDetails"
  | "getLoadedContext"
  | "searchMentions"
  | "listSlashCommands"
  | "openTerminal"
  | "openBrowser"
  | "artifactUrl"
  | "listMemoryFiles"
  | "readConfigFile"
  | "writeConfigFile"
  | "listSkills"
  | "setSkillEnabled"
  | "listSubagents"
  | "listMcpServers"
  | "testMcpServer"
>;

/** Setup, workbench and agent-configuration parts of the mock client. */
export function workbenchApi(world: MockWorld): WorkbenchApi {
  let setupStarted = 0;
  let codexFixed = false;
  const skillState = new Map(skills.map((s) => [s.id, s.enabled]));

  /** Checks resolve one by one over ~2.5s, like parallel detection finishing. */
  const setupStatus = (): SetupStatus => {
    if (!setupStarted) setupStarted = Date.now();
    const elapsed = Date.now() - setupStarted;
    const checks = setupChecks.map((check, i) => {
      if (elapsed < 500 + i * 450) return { ...check, state: "checking" as const, detail: null };
      if (check.id === "codex" && codexFixed)
        return {
          ...check,
          state: "ok" as const,
          detail: "v0.58.0 · signed in with ChatGPT",
          fix: null,
        };
      return check;
    });
    const ready = checks.some((c) => (c.id === "claude" || c.id === "codex") && c.state === "ok");
    return { checks, ready, completed: false };
  };

  return {
    getSetupStatus: () => delay(setupStatus(), 60),
    recheckSetup: (id) => {
      if (id === "codex") codexFixed = true;
      return delay(setupStatus(), 600);
    },
    completeSetup: () => delay(undefined),
    listDirectory: (path) => delay(listDir(path), 90),

    getDiff: (sessionId, scope) => {
      const files = sessionDiffs[sessionId] ?? [];
      const turns = Object.values(world.transcript(sessionId).turns)
        .filter((t) => t.threadId === world.transcript(sessionId).rootThreadId)
        .map((t, i) => ({ id: t.id, index: i + 1, label: `Turn ${i + 1}`, at: t.startedAt }));
      const scoped =
        scope.kind === "turn" && scope.turnId !== turns[0]?.id ? files.slice(0, 1) : files;
      const result: DiffResult = {
        scope,
        files: scope.kind === "uncommitted" ? [] : scoped,
        turns,
      };
      return delay(result, 150);
    },
    listFiles: () => delay(fileTree),
    readFile: (_sessionId, path) =>
      delay({
        path,
        contents:
          world.files.get(path) ??
          fileContents[path] ??
          `// ${path}\n// (mock) File contents are loaded from the session worktree.\n\nexport {};\n`,
      }),
    getPrDetails: (sessionId) => delay(prDetails[sessionId] ?? { issue: null, pr: null }),
    getLoadedContext: () =>
      delay({
        memory: [
          "~/.claude/CLAUDE.md",
          "CLAUDE.md",
          ".claude/rules/testing.md",
          ".claude/rules/ui.md",
        ],
        skills: ["frontend-design", "playwright-e2e"],
        mcpServers: ["codeden", "playwright"],
      }),
    searchMentions: (_sessionId, query) => {
      const q = query.toLowerCase();
      const hits = allPaths()
        .filter((p) => p.path.toLowerCase().includes(q))
        .sort((a, b) => a.path.length - b.path.length)
        .slice(0, 8);
      return delay(hits, 40);
    },
    listSlashCommands: () => delay(slashCommands, 20),
    openTerminal: (opts) => mockTerminal(opts),
    openBrowser: () => mockBrowser(),
    artifactUrl: (id) => artifacts[id]?.() ?? generatedIllustration(id.length),

    listMemoryFiles: () => delay(memoryFiles),
    readConfigFile: (path) =>
      delay(world.files.get(`cfg:${path}`) ?? configContents[path] ?? `# ${path}\n\n`, 80),
    writeConfigFile: (path, contents) => {
      world.files.set(`cfg:${path}`, contents);
      return delay(undefined, 250);
    },
    listSkills: () =>
      delay(skills.map((s) => ({ ...s, enabled: skillState.get(s.id) ?? s.enabled }))),
    setSkillEnabled: (id, enabled) => {
      skillState.set(id, enabled);
      return delay(undefined);
    },
    listSubagents: () => delay(subagents),
    listMcpServers: () => delay(mcpServers),
    testMcpServer: (id) => {
      const server = mcpServers.find((s) => s.id === id);
      const ok = server?.status !== "error";
      return delay(
        {
          ok,
          message: ok
            ? `Connected · ${server?.toolCount ?? 0} tools`
            : "401 Unauthorized: run the provider's login",
        },
        700,
      );
    },
  };
}
