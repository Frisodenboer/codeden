import type { RunnerConnectionStatus, Snapshot, UiServerMessage } from "@codeden/contracts";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it } from "vitest";
import type { CodeDenClient } from "@/lib/api/client";
import { createMockClient } from "@/lib/api/mock";
import { snapshotKey } from "@/lib/queries";
import { startRealtime } from "@/lib/realtime";
import { useConnectionStore } from "@/stores/connection";

let stop: (() => void) | undefined;
afterEach(() => stop?.());

/** A client with a real snapshot whose live messages the test sends. */
async function liveClient() {
  const snapshot = await createMockClient().getSnapshot();
  let push: (msg: UiServerMessage) => void = () => {};
  const client = {
    getSnapshot: async () => snapshot,
    subscribe: (_fromSeq: number, onMessage: (msg: UiServerMessage) => void) => {
      push = onMessage;
      return () => {};
    },
    onConnectionChange: () => () => {},
  } as unknown as CodeDenClient;
  return { snapshot, client, push: (msg: UiServerMessage) => push(msg) };
}

describe("realtime runner status", () => {
  it("applies a live runner update to the snapshot the pickers read", async () => {
    const { snapshot, client, push } = await liveClient();
    const queryClient = new QueryClient();
    stop = startRealtime(client, queryClient);
    await expect
      .poll(() => queryClient.getQueryData<Snapshot>(snapshotKey)?.seq)
      .toBe(snapshot.seq);

    const runner: RunnerConnectionStatus = {
      ...snapshot.runner,
      state: "connected",
      providers: [
        {
          id: "codex",
          displayName: "Codex",
          capabilities: snapshot.runner.providers[0]?.capabilities ?? ({} as never),
          models: [
            {
              id: "gpt-6.1-sol",
              label: "GPT-6.1-Sol",
              efforts: ["low", "medium", "high", "xhigh", "max"],
              isDefault: true,
            },
          ],
        },
      ],
    };
    push({ type: "runner", runner });

    const cached = queryClient.getQueryData<Snapshot>(snapshotKey);
    expect(cached?.runner.providers[0]?.models.map((m) => m.id)).toEqual(["gpt-6.1-sol"]);
    expect(cached?.sessions).toBe(snapshot.sessions);
    expect(useConnectionStore.getState().runner).toEqual(runner);
  });
});
