import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options, Query, ModelInfo as SdkModelInfo } from "@anthropic-ai/claude-agent-sdk";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeAdapter } from "../src/claude/adapter";
import { listClaudeModels, toModelInfos } from "../src/claude/models";
import { type ClaudeSdkModule, claudeSdkReady } from "../src/claude/sdk";
import type { ResolvedCommand } from "../src/util/exec";

const exe: ResolvedCommand = { kind: "native", path: "/opt/claude/claude" };

const SDK_MODELS: SdkModelInfo[] = [
  {
    value: "default",
    displayName: "Default (recommended)",
    description: "Opus 5 for complex work",
    supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
  },
  { value: "sonnet", displayName: "Sonnet", description: "", supportedEffortLevels: ["low"] },
  { value: "haiku", displayName: "", description: "Fastest" },
];

type Behaviour = "list" | "hang" | "fail" | "empty";

/**
 * A stand-in for the SDK's `query()`. It records the options and whether the prompt stream
 * ever produced a user message (it must not: that would start a billable turn).
 */
function stubSdk(initial: Behaviour = "list") {
  const state = {
    behaviour: initial,
    launches: [] as Options[],
    promptMessages: 0,
    closed: 0,
  };
  const query = ((params: { prompt: AsyncIterable<unknown>; options: Options }) => {
    state.launches.push(params.options);
    // The CLI reads the prompt stream; count anything it yields.
    void (async () => {
      for await (const _message of params.prompt) state.promptMessages++;
    })();
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    params.options.abortController?.signal.addEventListener("abort", () => finish());
    const q = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await done;
          return { done: true as const, value: undefined };
        },
      }),
      supportedModels: async () => {
        if (state.behaviour === "fail") throw new Error("CLI exited");
        if (state.behaviour === "hang") return new Promise<SdkModelInfo[]>(() => {});
        return state.behaviour === "empty" ? [] : SDK_MODELS;
      },
      close: () => {
        state.closed++;
        finish();
      },
    };
    return q as unknown as Query;
  }) as unknown as ClaudeSdkModule["query"];
  return { query, state, load: async () => ({ query }) };
}

const EXPECTED = [
  {
    id: "default",
    label: "Default (recommended)",
    description: "Opus 5 for complex work",
    efforts: ["low", "medium", "high", "xhigh", "max"],
    isDefault: true,
  },
  { id: "sonnet", label: "Sonnet", efforts: ["low"] },
  { id: "haiku", label: "haiku", description: "Fastest", efforts: [] },
];

describe("listClaudeModels", () => {
  it("maps the SDK's model rows; the first one is the default", () => {
    expect(toModelInfos(SDK_MODELS)).toEqual(EXPECTED);
  });

  it("starts the CLI without a turn, reads supportedModels and closes it", async () => {
    const sdk = stubSdk();
    await expect(listClaudeModels(sdk.query, exe, { timeoutMs: 1_000 })).resolves.toEqual(EXPECTED);
    const [options] = sdk.state.launches;
    expect(options).toMatchObject({
      pathToClaudeCodeExecutable: exe.path,
      cwd: tmpdir(),
      settingSources: [],
      persistSession: false,
      tools: [],
      mcpServers: {},
      strictMcpConfig: true,
    });
    expect(options?.abortController?.signal.aborted).toBe(true);
    expect(sdk.state.closed).toBe(1);
    await new Promise((r) => setTimeout(r, 10));
    expect(sdk.state.promptMessages).toBe(0);
  });

  it("gives up on a CLI that never answers, and still closes it", async () => {
    const sdk = stubSdk("hang");
    const started = Date.now();
    await expect(listClaudeModels(sdk.query, exe, { timeoutMs: 200 })).rejects.toThrow(
      /within 200ms/,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(sdk.state.closed).toBe(1);
  });
});

describe("ClaudeAdapter model discovery", () => {
  it("replaces the alias fallback with the CLI's list and reports the change once", async () => {
    const sdk = stubSdk();
    const adapter = new ClaudeAdapter({ executable: exe, loadSdk: sdk.load });
    expect(adapter.models().map((m) => m.id)).toEqual(["default", "opus", "sonnet", "haiku"]);
    let changes = 0;
    adapter.onModelsChanged(() => changes++);

    // Concurrent refreshes share one CLI.
    await Promise.all([adapter.refreshModels(), adapter.refreshModels()]);
    expect(adapter.models()).toEqual(EXPECTED);
    expect(changes).toBe(1);
    expect(sdk.state.launches).toHaveLength(1);

    // The same list again is not a change.
    await adapter.refreshModels();
    expect(changes).toBe(1);
    expect(sdk.state.launches).toHaveLength(2);
  });

  it("keeps the last list when discovery fails, times out or lists nothing, and never throws", async () => {
    const sdk = stubSdk("fail");
    const adapter = new ClaudeAdapter({
      executable: exe,
      loadSdk: sdk.load,
      modelListTimeoutMs: 100,
    });
    await expect(adapter.refreshModels()).resolves.toBeUndefined();
    expect(adapter.models().map((m) => m.id)).toEqual(["default", "opus", "sonnet", "haiku"]);

    sdk.state.behaviour = "list";
    await adapter.refreshModels();
    for (const behaviour of ["fail", "hang", "empty"] as const) {
      sdk.state.behaviour = behaviour;
      await expect(adapter.refreshModels()).resolves.toBeUndefined();
      expect(adapter.models()).toEqual(EXPECTED);
    }

    const broken = new ClaudeAdapter({
      executable: exe,
      loadSdk: async () => {
        throw new Error("install failed");
      },
    });
    await expect(broken.refreshModels()).resolves.toBeUndefined();
  });

  it("skips discovery when Claude Code is not installed", async () => {
    const sdk = stubSdk();
    const saved = { PATH: process.env.PATH, Path: process.env.Path };
    const empty = mkdtempSync(join(tmpdir(), "codeden-empty-path-"));
    process.env.PATH = empty;
    if (process.platform === "win32") process.env.Path = empty;
    try {
      const adapter = new ClaudeAdapter({ loadSdk: sdk.load });
      await adapter.refreshModels();
      expect(sdk.state.launches).toHaveLength(0);
      expect(adapter.models().map((m) => m.id)).toEqual(["default", "opus", "sonnet", "haiku"]);
    } finally {
      process.env.PATH = saved.PATH;
      if (process.platform === "win32") process.env.Path = saved.Path;
    }
  });
});

describe("claudeSdkReady", () => {
  const saved = process.env.CODEDEN_CLAUDE_SDK;
  afterEach(() => {
    if (saved === undefined) delete process.env.CODEDEN_CLAUDE_SDK;
    else process.env.CODEDEN_CLAUDE_SDK = saved;
  });

  it("never asks discovery to install the SDK", async () => {
    process.env.CODEDEN_CLAUDE_SDK = "workspace";
    expect(claudeSdkReady()).toBe(true);
    // The published bundle with nothing installed yet: discovery waits for a session to
    // install the SDK.
    process.env.CODEDEN_CLAUDE_SDK = "deps";
    const { configureClaudeSdk } = await import("../src/claude/sdk");
    configureClaudeSdk({ depsDir: mkdtempSync(join(tmpdir(), "codeden-deps-")) });
    expect(claudeSdkReady()).toBe(false);
    const adapter = new ClaudeAdapter({ executable: exe });
    await expect(adapter.refreshModels()).resolves.toBeUndefined();
    expect(adapter.models().map((m) => m.id)).toEqual(["default", "opus", "sonnet", "haiku"]);
  });
});
