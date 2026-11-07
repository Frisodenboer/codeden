import { CODEDEN_VERSION } from "@codeden/contracts";
import { type ResolvedCommand, spawnResolved } from "../util/exec";
import type { InitializeParams, InitializeResponse } from "./protocol";
import { CodexRpc, type CodexRpcHandlers } from "./rpc";

/** Notifications CodeDen never uses; opting out keeps the stdio stream small. */
const OPT_OUT = [
  "rawResponseItem/completed",
  "rawResponse/completed",
  "remoteControl/status/changed",
  "fuzzyFileSearch/sessionUpdated",
  "fuzzyFileSearch/sessionCompleted",
];

/** Spawn `codex app-server` (stdio) and complete the `initialize` handshake. */
export async function startAppServer(
  exe: ResolvedCommand,
  handlers: CodexRpcHandlers,
  opts: { env?: Record<string, string>; cwd?: string } = {},
): Promise<{ rpc: CodexRpc; info: InitializeResponse }> {
  const child = spawnResolved(exe, ["app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, ...opts.env },
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  });
  const rpc = new CodexRpc(child, handlers);
  const params: InitializeParams = {
    clientInfo: { name: "codeden", title: "CodeDen", version: CODEDEN_VERSION },
    capabilities: {
      experimentalApi: false,
      requestAttestation: false,
      optOutNotificationMethods: OPT_OUT,
    },
  };
  try {
    const info = await rpc.request<InitializeResponse>("initialize", params);
    rpc.notify("initialized");
    return { rpc, info };
  } catch (error) {
    rpc.close();
    throw error;
  }
}
