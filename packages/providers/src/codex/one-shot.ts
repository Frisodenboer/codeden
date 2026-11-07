import { tmpdir } from "node:os";
import type { ResolvedCommand } from "../util/exec";
import { type OneShotRequest, oneShotSignal, type UtilityModel } from "../utility";
import { startAppServer } from "./process";
import type { ServerNotification } from "./protocol";
import type { ThreadStartResponse } from "./protocol/v2";

/** Empty string = the user's configured Codex model. */
export const CODEX_UTILITY_MODEL = "";

/**
 * One-shot Codex call for the utility model: an ephemeral thread in a read-only sandbox with
 * approvals off, low reasoning effort, and no MCP servers. Returns the final agent message.
 */
export class CodexUtilityModel implements UtilityModel {
  readonly providerId = "codex";
  readonly defaultModel = CODEX_UTILITY_MODEL;

  constructor(private readonly resolveExecutable: () => ResolvedCommand | undefined) {}

  async runOneShot(request: OneShotRequest): Promise<string> {
    const exe = this.resolveExecutable();
    if (!exe) throw new Error("Codex is not installed");
    const { signal, dispose } = oneShotSignal(request);
    let finish: (text: string) => void = () => {};
    let fail: (error: Error) => void = () => {};
    const done = new Promise<string>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    });
    let threadId: string | undefined;
    let last = "";
    const onNotification = (n: ServerNotification) => {
      if (
        n.method === "item/completed" &&
        n.params.item.type === "agentMessage" &&
        n.params.threadId === threadId
      ) {
        last = n.params.item.text;
      } else if (n.method === "turn/completed" && n.params.threadId === threadId) {
        if (n.params.turn.status === "completed") finish(last.trim());
        else
          fail(new Error(n.params.turn.error?.message ?? `Utility turn ${n.params.turn.status}`));
      }
    };
    const { rpc } = await startAppServer(
      exe,
      {
        onNotification,
        onRequest: async () => ({ decision: "decline" }),
        onExit: (code) => fail(new Error(`codex app-server exited (code ${code ?? "unknown"})`)),
      },
      { cwd: tmpdir() },
    );
    const onAbort = () =>
      fail(signal.reason instanceof Error ? signal.reason : new Error("Aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      const model = request.model ?? CODEX_UTILITY_MODEL;
      const thread = await rpc.request<ThreadStartResponse>("thread/start", {
        cwd: tmpdir(),
        ephemeral: true,
        approvalPolicy: "never",
        sandbox: "read-only",
        ...(model ? { model } : {}),
        config: { mcp_servers: {} },
        ...(request.system ? { baseInstructions: request.system } : {}),
      });
      threadId = thread.thread.id;
      await rpc.request("turn/start", {
        threadId,
        input: [{ type: "text", text: request.prompt, text_elements: [] }],
        effort: "low",
      });
      return await done;
    } finally {
      signal.removeEventListener("abort", onAbort);
      dispose();
      rpc.close();
    }
  }
}
