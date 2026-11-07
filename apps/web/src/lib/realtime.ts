import { ServerToClientMessage } from "@codeden/contracts";
import type { QueryClient } from "@tanstack/react-query";
import { useConnectionStore } from "@/stores/connection";
import { serverOrigin } from "./api";

/**
 * Realtime connection (§6): subscribe from the last applied seq, apply event batches,
 * reload the snapshot on `resync`, and reconnect with backoff.
 */
export function connectRealtime(queryClient: QueryClient): () => void {
  let ws: WebSocket | undefined;
  let stopped = false;
  let delay = 500;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const store = useConnectionStore.getState;

  const open = () => {
    store().setSocket("connecting");
    ws = new WebSocket(`${serverOrigin.replace(/^http/, "ws")}/ws`);
    ws.onopen = () => {
      delay = 500;
      store().setSocket("open");
      ws?.send(JSON.stringify({ type: "subscribe", fromSeq: store().seq }));
    };
    ws.onmessage = (event) => {
      const parsed = ServerToClientMessage.safeParse(JSON.parse(String(event.data)));
      if (!parsed.success) return;
      const msg = parsed.data;
      if (msg.type === "runner") store().setRunner(msg.runner);
      if (msg.type === "events" && msg.events.length > 0) {
        store().setSeq(msg.events.at(-1)?.seq ?? store().seq);
        // M0: refresh the snapshot on domain changes; transcripts arrive in M1.
        if (msg.events.some((e) => !e.type.startsWith("agent."))) {
          void queryClient.invalidateQueries({ queryKey: ["snapshot"] });
        }
      }
      if (msg.type === "resync") {
        store().setSeq(msg.seq);
        void queryClient.invalidateQueries();
        ws?.send(JSON.stringify({ type: "subscribe", fromSeq: msg.seq }));
      }
    };
    ws.onclose = () => {
      store().setSocket("closed");
      if (stopped) return;
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, 10_000);
    };
  };

  open();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    ws?.close();
  };
}
