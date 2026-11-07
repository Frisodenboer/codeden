import type { RunnerConnectionStatus } from "@codeden/contracts";
import { create } from "zustand";

export type SocketState = "connecting" | "open" | "closed";

interface ConnectionState {
  socket: SocketState;
  /** Highest event seq applied by this client. */
  seq: number;
  runner: RunnerConnectionStatus | null;
  setSocket: (socket: SocketState) => void;
  setSeq: (seq: number) => void;
  setRunner: (runner: RunnerConnectionStatus) => void;
}

/** Live connection state fed by the realtime WebSocket. */
export const useConnectionStore = create<ConnectionState>()((set) => ({
  socket: "connecting",
  seq: 0,
  runner: null,
  setSocket: (socket) => set({ socket }),
  setSeq: (seq) => set({ seq }),
  setRunner: (runner) => set({ runner }),
}));
