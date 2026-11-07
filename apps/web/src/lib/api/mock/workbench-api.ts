import type { DiffResult, SetupStatus } from "@codeden/contracts";
import type { CodeDenClient } from "../client";
import { mockTerminal } from "./channels";
import { ciFailureShot, contrastComparison, generatedIllustration } from "./fixtures/images";
import { listDir, setupChecks } from "./fixtures/ops";
import {
  allPaths,
  fileContents,
  fileTree,
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
  | "loginCommand"
  | "completeSetup"
  | "listDirectory"
  | "getDiff"
  | "restoreFiles"
  | "gitStatus"
  | "gitCommit"
  | "gitPush"
  | "speechSummary"
  | "listFiles"
  | "readFile"
  | "searchMentions"
  | "listSlashCommands"
  | "openTerminal"
  | "artifactUrl"
>;

/** Setup, workbench and agent-configuration parts of the mock client. */
export function workbenchApi(world: MockWorld): WorkbenchApi {
  let codexFixed = false;

  const setupStatus = (): SetupStatus => {
    const checks = setupChecks.map((check) =>
      check.id === "codex" && codexFixed
        ? {
            ...check,
            state: "ok" as const,
            loggedIn: true,
            message: "v0.58.0 · signed in with ChatGPT",
            fix: null,
          }
        : check,
    );
    const ready = checks.some((c) => (c.id === "claude" || c.id === "codex") && c.state === "ok");
    return {
      checkedAt: new Date().toISOString(),
      setupCompleted: false,
      ready,
      checks,
      warnings: [],
    };
  };

  return {
    getSetupStatus: (opts) => delay(setupStatus(), opts?.refresh ? 900 : 400),
    loginCommand: (tool) => {
      if (tool === "codex") codexFixed = true;
      const command = { claude: "claude auth login", codex: "codex login", gh: "gh auth login" }[
        tool
      ];
      const [bin = tool, ...args] = command.split(" ");
      return delay({ tool, command: bin, args });
    },
    completeSetup: () => delay(undefined),
    listDirectory: (path, opts) => delay(listDir(path, opts?.showHidden), 90),

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
    restoreFiles: (_sessionId, req) =>
      delay({ index: req.index ?? 0, restored: req.paths ?? [], deleted: [] }, 300),
    gitStatus: () =>
      delay({
        branch: "codeden/fix-checkout-flake",
        baseBranch: "main",
        ahead: 2,
        behind: 0,
        files: [
          { path: "src/checkout/useCart.ts", status: "M" },
          { path: "tests/e2e/checkout.spec.ts", status: "M" },
        ],
      }),
    gitCommit: () => delay({ commit: "4f2a91c" }, 400),
    gitPush: () => delay({ remote: "origin", branch: "codeden/fix-checkout-flake" }, 600),
    speechSummary: (text) => delay({ text: text.slice(0, 200), source: "plain" as const }),
    listFiles: () =>
      delay({
        root: "~/.codeden/wt/storefront/fix-checkout-flake",
        entries: allPaths(fileTree),
        truncated: false,
      }),
    readFile: (_sessionId, path) => {
      const content =
        world.files.get(path) ??
        fileContents[path] ??
        `// ${path}\n// (mock) File contents are loaded from the session worktree.\n\nexport {};\n`;
      return delay({ path, content, sizeBytes: content.length, binary: false, truncated: false });
    },
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
    artifactUrl: (id) => artifacts[id]?.() ?? generatedIllustration(id.length),
  };
}
