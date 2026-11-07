import type { RunnerConnectionStatus } from "@codeden/contracts";
import { create } from "zustand";

export type SocketState = "connecting" | "open" | "closed";
export type AuthState = "unknown" | "ok" | "unauthorized";

interface ConnectionState {
  socket: SocketState;
  /** `unauthorized` after a 401: the browser has no valid CodeDen cookie. */
  auth: AuthState;
  /** Highest event seq applied by this client. */
  seq: number;
  runner: RunnerConnectionStatus | null;
  setSocket: (socket: SocketState) => void;
  setAuth: (auth: AuthState) => void;
  setSeq: (seq: number) => void;
  setRunner: (runner: RunnerConnectionStatus) => void;
}

/** Live connection state fed by the realtime WebSocket. */
export const useConnectionStore = create<ConnectionState>()((set) => ({
  socket: "connecting",
  auth: "unknown",
  seq: 0,
  runner: null,
  setSocket: (socket) => set({ socket }),
  setAuth: (auth) => set({ auth }),
  setSeq: (seq) => set({ seq }),
  setRunner: (runner) => set({ runner }),
}));
