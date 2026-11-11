import type { Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { quickLocate } from "../util/locate";
import { claudeEnv, executableOptions } from "./options";
import { claudeSdkReady, loadClaudeSdk } from "./sdk";

/** One slash command Claude Code accepts in a session's folder. */
export interface ClaudeCommand {
  name: string;
  description: string;
  argumentHint: string;
  /** Claude Code's own command (absent for user, project, plugin and MCP commands and skills). */
  builtin: boolean;
}

const TIMEOUT_MS = 20_000;
/** Lists per folder are kept this long, so typing `/` stays instant. */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; list: Promise<ClaudeCommand[]> }>();

/**
 * The slash commands Claude Code supports in `cwd`: its own commands plus the user's, the
 * project's and plugins' commands and skills (`supportedCommands()`). Like model discovery, the
 * CLI only starts and answers `initialize`: no message is sent, nothing is persisted, hooks are
 * off, and it closes as soon as the list arrives. Cached per folder for a minute. Resolves to
 * an empty list when Claude Code (or its SDK) is not available.
 */
export function listClaudeCommands(cwd: string): Promise<ClaudeCommand[]> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  const list = discover(cwd).catch(() => [] as ClaudeCommand[]);
  cache.set(cwd, { at: Date.now(), list });
  return list;
}

async function discover(cwd: string): Promise<ClaudeCommand[]> {
  const executable = quickLocate("claude");
  if (!executable || !claudeSdkReady()) return [];
  const { query } = await loadClaudeSdk();
  const abortController = new AbortController();
  const stopped = new Promise<void>((resolve) =>
    abortController.signal.addEventListener("abort", () => resolve(), { once: true }),
  );
  // The prompt stream stays open, empty, until discovery is over.
  const idle = (): AsyncIterable<SDKUserMessage> => ({
    [Symbol.asyncIterator]: () => ({
      next: async () => {
        await stopped;
        return { done: true, value: undefined };
      },
    }),
  });
  let q: Query | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    q = query({
      prompt: idle(),
      options: {
        ...executableOptions(executable),
        cwd,
        settingSources: ["user", "project", "local"],
        settings: { disableAllHooks: true },
        persistSession: false,
        tools: [],
        mcpServers: {},
        strictMcpConfig: true,
        env: claudeEnv(undefined),
        abortController,
      },
    });
    const stream = q;
    void (async () => {
      for await (const _message of stream) {
        // nothing to do
      }
    })().catch(() => undefined);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("Claude Code did not list its commands")),
        TIMEOUT_MS,
      );
    });
    const commands = await Promise.race([q.supportedCommands(), timeout]);
    return commands.map((c) => ({
      name: c.name,
      description: c.description,
      argumentHint: c.argumentHint,
      builtin: c.builtin === true,
    }));
  } finally {
    clearTimeout(timer);
    abortController.abort();
    try {
      q?.close();
    } catch {
      // already closed
    }
  }
}
