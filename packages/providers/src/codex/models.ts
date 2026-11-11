import { tmpdir } from "node:os";
import type { ModelInfo, ReasoningEffort } from "@codeden/contracts";
import { ReasoningEffort as ReasoningEffortSchema } from "@codeden/contracts";
import type { ResolvedCommand } from "../util/exec";
import { startAppServer } from "./process";
import type { Model, ModelListResponse } from "./protocol/v2";

/** How long model discovery may take, app-server start-up included. */
export const CODEX_MODEL_LIST_TIMEOUT_MS = 20_000;

/** `model/list` pages are followed up to this many (a guard against a looping cursor). */
const MAX_PAGES = 20;

/**
 * Map an app-server `Model` to CodeDen's `ModelInfo`. The id is the model slug Codex accepts
 * in `thread/start` and `turn/start`. Efforts CodeDen does not know are dropped, and missing
 * fields (older app-servers) are tolerated.
 */
export function modelInfoFromCodex(m: Model): ModelInfo {
  const efforts = (m.supportedReasoningEfforts ?? [])
    .map((e) => e.reasoningEffort)
    .filter((e): e is ReasoningEffort => ReasoningEffortSchema.safeParse(e).success);
  const defaultEffort = ReasoningEffortSchema.safeParse(m.defaultReasoningEffort);
  return {
    id: m.model,
    label: m.displayName || m.model,
    ...(m.description ? { description: m.description } : {}),
    efforts,
    ...(defaultEffort.success ? { defaultEffort: defaultEffort.data } : {}),
    ...(m.isDefault ? { isDefault: true } : {}),
  };
}

/** The models Codex shows in its own picker, as `ModelInfo`. */
export function visibleCodexModels(models: readonly Model[]): ModelInfo[] {
  return models.filter((m) => !m.hidden && m.model).map(modelInfoFromCodex);
}

export interface ListCodexModelsOptions {
  timeoutMs?: number;
}

/**
 * Ask a short-lived `codex app-server` for its model list (`model/list`, every page). No
 * thread is started and no turn runs. Rejects on failure or after `timeoutMs`; the process
 * is stopped either way.
 */
export async function listCodexModels(
  exe: ResolvedCommand,
  opts: ListCodexModelsOptions = {},
): Promise<ModelInfo[]> {
  const timeoutMs = opts.timeoutMs ?? CODEX_MODEL_LIST_TIMEOUT_MS;
  const abort = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`codex app-server did not list models within ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([fetchModels(exe, abort.signal), timeout]);
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}

async function fetchModels(exe: ResolvedCommand, signal: AbortSignal): Promise<ModelInfo[]> {
  const { rpc } = await startAppServer(
    exe,
    {
      onNotification: () => {},
      onRequest: async () => {
        throw new Error("CodeBench's model discovery answers no requests");
      },
      onExit: () => {},
    },
    { cwd: tmpdir(), signal },
  );
  const models: Model[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res: ModelListResponse = await rpc.request<ModelListResponse>(
      "model/list",
      cursor ? { cursor } : {},
    );
    models.push(...(res.data ?? []));
    cursor = res.nextCursor ?? null;
    if (!cursor) break;
  }
  return visibleCodexModels(models);
}
