import { tmpdir } from "node:os";
import type { ResolvedCommand } from "../util/exec";
import { explicitModel } from "../util/model";
import { str } from "../util/text";
import { type OneShotRequest, oneShotSignal, type UtilityModel } from "../utility";
import { claudeEnv, executableOptions } from "./options";
import { loadClaudeSdk } from "./sdk";

/** Default utility model: the CLI's small-model alias. */
export const CLAUDE_UTILITY_MODEL = "haiku";

/**
 * One-shot Claude call for the utility model: one turn, no tools, no MCP servers, no settings
 * or hooks loaded, nothing persisted.
 */
export class ClaudeUtilityModel implements UtilityModel {
  readonly providerId = "claude";
  readonly defaultModel = CLAUDE_UTILITY_MODEL;

  constructor(private readonly resolveExecutable: () => ResolvedCommand | undefined) {}

  async runOneShot(request: OneShotRequest): Promise<string> {
    const exe = this.resolveExecutable();
    if (!exe) throw new Error("Claude Code is not installed");
    const { signal, dispose } = oneShotSignal(request);
    const abortController = new AbortController();
    signal.addEventListener("abort", () => abortController.abort(), { once: true });
    try {
      const { query } = await loadClaudeSdk();
      const q = query({
        prompt: request.prompt,
        options: {
          ...executableOptions(exe),
          cwd: tmpdir(),
          model: explicitModel(request.model) ?? CLAUDE_UTILITY_MODEL,
          maxTurns: 1,
          tools: [],
          mcpServers: {},
          strictMcpConfig: true,
          settingSources: [],
          persistSession: false,
          permissionMode: "dontAsk",
          thinking: { type: "disabled" },
          ...(request.system ? { systemPrompt: request.system } : {}),
          env: claudeEnv(undefined),
          abortController,
        },
      });
      let text = "";
      for await (const message of q) {
        if (message.type === "assistant" && !message.parent_tool_use_id) {
          for (const block of message.message.content) {
            if (block.type === "text") text += block.text;
          }
        }
        if (message.type === "result") {
          if (message.subtype !== "success" || message.is_error) {
            throw new Error(`Utility model failed: ${message.subtype}`);
          }
          return (str(message, "result") ?? text).trim();
        }
      }
      if (signal.aborted)
        throw signal.reason instanceof Error ? signal.reason : new Error("Aborted");
      return text.trim();
    } finally {
      dispose();
    }
  }
}
