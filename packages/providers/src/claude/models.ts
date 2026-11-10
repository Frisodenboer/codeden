import { tmpdir } from "node:os";
import type {
  Query,
  SDKUserMessage,
  ModelInfo as SdkModelInfo,
} from "@anthropic-ai/claude-agent-sdk";
import type { ModelInfo, ReasoningEffort } from "@codeden/contracts";
import type { ResolvedCommand } from "../util/exec";
import { claudeEnv, executableOptions } from "./options";
import type { ClaudeSdkModule } from "./sdk";

/** Default limit for model discovery, CLI start-up included. */
export const CLAUDE_MODEL_LIST_TIMEOUT_MS = 30_000;

/**
 * The SDK's model rows as CodeDen models. The first row is Claude Code's default. An alias row
 * (`opus`) keeps the full id it runs today (`resolvedModel`) as `resolvedId`.
 */
export function toModelInfos(models: readonly SdkModelInfo[]): ModelInfo[] {
  return models.map((m, i) => ({
    id: m.value,
    ...(m.resolvedModel && m.resolvedModel !== m.value ? { resolvedId: m.resolvedModel } : {}),
    label: m.displayName || m.value,
    ...(m.description ? { description: m.description } : {}),
    efforts: (m.supportedEffortLevels ?? []) as ReasoningEffort[],
    ...(i === 0 ? { isDefault: true } : {}),
  }));
}

/**
 * List Claude Code's models without a turn. `query()` with a streaming prompt that never
 * yields starts the CLI and sends only the `initialize` control request, whose answer carries
 * the model list (`supportedModels()`); no user message is sent, so no model request is made.
 * Nothing from the user's or a project's settings is loaded (no hooks run), nothing is
 * persisted, and the CLI is closed as soon as the list arrives or `timeoutMs` passes.
 * Rejects on timeout or when the CLI fails to start.
 */
export async function listClaudeModels(
  query: ClaudeSdkModule["query"],
  executable: ResolvedCommand,
  opts: { timeoutMs?: number } = {},
): Promise<ModelInfo[]> {
  const timeoutMs = opts.timeoutMs ?? CLAUDE_MODEL_LIST_TIMEOUT_MS;
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
        cwd: tmpdir(),
        settingSources: [],
        persistSession: false,
        tools: [],
        mcpServers: {},
        strictMcpConfig: true,
        env: claudeEnv(undefined),
        abortController,
      },
    });
    // Read (and drop) whatever the CLI streams, so its output never backs up.
    const stream = q;
    void (async () => {
      for await (const _message of stream) {
        // nothing to do
      }
    })().catch(() => undefined);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Claude Code did not list its models within ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    return toModelInfos(await Promise.race([q.supportedModels(), timeout]));
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
