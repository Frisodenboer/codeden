import { tmpdir } from "node:os";
import type { ImageGenerationItem, ServerNotification, ServerRequest } from "../codex/protocol";
import type { JsonValue } from "../codex/protocol/serde_json/JsonValue";
import type { ThreadStartResponse } from "../codex/protocol/v2";
import { CodexRpcError, type CodexRpcHandlers } from "../codex/rpc";
import { ImageGenerationError, toImageError } from "./errors";

/** The slice of `CodexRpc` an image turn needs; tests pass a fake. */
export interface ImageTurnRpc {
  request<T>(method: string, params: unknown): Promise<T>;
  close(): Promise<void> | void;
}

/** Spawn `codex app-server` (or a fake) with these handlers. */
export type ConnectCodex = (handlers: CodexRpcHandlers, cwd: string) => Promise<ImageTurnRpc>;

export interface CodexImageTurnParams {
  prompt: string;
  referenceImages: readonly string[];
  /** Stop as soon as this many images arrived. */
  count: number;
  /** Empty = the user's configured Codex model. */
  model?: string;
  signal: AbortSignal;
}

export interface CodexImage {
  data: Buffer;
  revisedPrompt: string | null;
  /** Codex keeps its own copy under `~/.codex/generated_images/<thread>/`. */
  savedPath?: string;
}

export interface CodexImageTurnResult {
  images: CodexImage[];
  model: string;
  threadId: string;
}

/** Kept short so the turn spends few tokens; the model only needs to call one tool. */
export const CODEX_IMAGE_INSTRUCTIONS =
  "You generate images for CodeDen. Use only your built-in image generation tool. Never run " +
  "shell commands, read or edit files, browse, or call any other tool. Follow the requested " +
  "shape and count exactly. When the images are done, reply with the single word: done.";

/**
 * Config overrides that leave the image generation tool as the only useful tool: the user's
 * MCP servers, plugins, apps, browser/computer use, web search, hooks and subagents are off,
 * and the turn runs in a read-only sandbox with approvals off.
 */
export function codexImageConfig(mcpServerNames: readonly string[]): Record<string, JsonValue> {
  const config: Record<string, JsonValue> = {
    "features.image_generation": true,
    "features.apps": false,
    "features.plugins": false,
    "features.remote_plugin": false,
    "features.tool_suggest": false,
    "features.skill_search": false,
    "features.browser_use": false,
    "features.computer_use": false,
    "features.code_mode_host": false,
    "features.multi_agent": false,
    "features.goals": false,
    "features.hooks": false,
    web_search: "disabled",
  };
  for (const name of mcpServerNames) {
    if (/^[\w-]+$/.test(name)) config[`mcp_servers.${name}.enabled`] = false;
  }
  return config;
}

/** Deny anything the model asks for; an image turn never needs approvals or input. */
export async function denyServerRequest(request: ServerRequest): Promise<unknown> {
  switch (request.method) {
    case "item/commandExecution/requestApproval":
    case "item/fileChange/requestApproval":
      return { decision: "decline" };
    case "item/permissions/requestApproval":
      return { permissions: {}, scope: "turn" };
    case "item/tool/requestUserInput":
      return { answers: {} };
    case "mcpServer/elicitation/request":
      return { action: "decline", content: null, _meta: null };
    case "execCommandApproval":
    case "applyPatchApproval":
      return { decision: { denied: { rejection: "Image generation turns cannot run tools" } } };
    default:
      throw new CodexRpcError(-32601, `Image turns do not handle ${request.method}`);
  }
}

function usageLimitError(
  failure: NonNullable<ImageGenerationItem["failure"]>,
): ImageGenerationError {
  const retryAfter = failure.resetsAt ? new Date(failure.resetsAt * 1000) : undefined;
  return new ImageGenerationError(
    "rate_limited",
    "codex",
    `Codex image generation limit reached${retryAfter ? ` (resets ${retryAfter.toISOString()})` : ""}`,
    retryAfter ? { retryAfter } : {},
  );
}

function turnError(
  error: { message: string; codexErrorInfo: unknown } | null,
): ImageGenerationError {
  const info = error?.codexErrorInfo;
  const message = error?.message ?? "The Codex turn failed";
  if (info === "usageLimitExceeded" || info === "rateLimitExceeded")
    return new ImageGenerationError("rate_limited", "codex", message);
  if (info === "unauthorized") return new ImageGenerationError("auth", "codex", message);
  if (info === "cyberPolicy" || info === "misalignmentPolicyViolation")
    return new ImageGenerationError("content_policy", "codex", message);
  return new ImageGenerationError("provider_error", "codex", message);
}

/**
 * Run one ephemeral, tool-restricted Codex turn and collect the `imageGeneration` items.
 * The images arrive base64-encoded in `item.result`, so nothing depends on Codex writing a
 * file itself. Resolves as soon as `count` images arrived (the app-server is then closed,
 * which ends the turn), or when the turn completes.
 */
export async function runCodexImageTurn(
  connect: ConnectCodex,
  params: CodexImageTurnParams,
): Promise<CodexImageTurnResult> {
  const { signal } = params;
  if (signal.aborted) throw toImageError(signal.reason, "codex", signal);
  let finish: () => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  // Failures are re-thrown where `done` is awaited; this only silences early rejections.
  done.catch(() => {});
  /** Settle a step early when the turn fails, is aborted, or times out. */
  const race = <T>(step: Promise<T>): Promise<T> => Promise.race([step, done.then(() => step)]);
  let connecting: Promise<ImageTurnRpc> | undefined;
  const images: CodexImage[] = [];
  let threadId: string | undefined;
  let lastText = "";
  const onNotification = (n: ServerNotification) => {
    if (!threadId || !("threadId" in n.params) || n.params.threadId !== threadId) return;
    if (n.method === "item/completed") {
      const item = n.params.item;
      if (item.type === "agentMessage" && item.text.trim()) lastText = item.text.trim();
      if (item.type !== "imageGeneration") return;
      if (item.failure?.type === "usageLimitExceeded") return fail(usageLimitError(item.failure));
      if (!item.result) return;
      images.push({
        data: Buffer.from(item.result, "base64"),
        revisedPrompt: item.revisedPrompt,
        ...(item.savedPath ? { savedPath: item.savedPath } : {}),
      });
      if (images.length >= params.count) finish();
    } else if (n.method === "error" && !n.params.willRetry) {
      fail(turnError(n.params.error));
    } else if (n.method === "turn/completed") {
      const turn = n.params.turn;
      if (turn.status === "completed") finish();
      else if (turn.status === "interrupted")
        fail(new ImageGenerationError("aborted", "codex", "The Codex turn was interrupted"));
      else fail(turnError(turn.error));
    }
  };
  const onAbort = () => fail(toImageError(signal.reason, "codex", signal));
  signal.addEventListener("abort", onAbort, { once: true });
  let rpc: ImageTurnRpc | undefined;
  try {
    const cwd = tmpdir();
    connecting = connect(
      {
        onNotification,
        onRequest: denyServerRequest,
        onExit: (code, stderr) =>
          fail(
            new ImageGenerationError(
              "provider_error",
              "codex",
              `codex app-server exited (code ${code ?? "unknown"})${stderr.trim() ? `: ${stderr.trim().slice(-300)}` : ""}`,
            ),
          ),
      },
      cwd,
    );
    rpc = await race(connecting);
    const servers = await race(
      rpc
        .request<{ config: Record<string, unknown> }>("config/read", { cwd })
        .then((r) => Object.keys((r.config.mcp_servers as Record<string, unknown> | null) ?? {}))
        .catch(() => [] as string[]),
    );
    const thread = await race(
      rpc.request<ThreadStartResponse>("thread/start", {
        cwd,
        ephemeral: true,
        approvalPolicy: "never",
        sandbox: "read-only",
        ...(params.model ? { model: params.model } : {}),
        config: codexImageConfig(servers),
        developerInstructions: CODEX_IMAGE_INSTRUCTIONS,
      }),
    );
    threadId = thread.thread.id;
    await race(
      rpc.request("turn/start", {
        threadId,
        input: [
          ...params.referenceImages.map((path) => ({ type: "localImage", path })),
          { type: "text", text: params.prompt, text_elements: [] },
        ],
        effort: "low",
      }),
    );
    await done;
    if (!images.length) {
      throw new ImageGenerationError(
        "no_image",
        "codex",
        `Codex finished without generating an image${lastText ? `: ${lastText.slice(0, 300)}` : ""}`,
      );
    }
    return { images: images.slice(0, params.count), model: thread.model, threadId };
  } catch (error) {
    throw toImageError(error, "codex", signal);
  } finally {
    signal.removeEventListener("abort", onAbort);
    // Closing ends the turn if it is still running (e.g. after an early finish or a timeout).
    if (rpc) void Promise.resolve(rpc.close()).catch(() => {});
    else void connecting?.then((late) => late.close()).catch(() => {});
  }
}
