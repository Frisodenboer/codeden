import { TERMINAL_CONTROL_PREFIX, TerminalServerMessage } from "@codeden/contracts";
import type { OpenTerminalOptions, TerminalChannel, TerminalEvent } from "./types";

/**
 * A runner terminal over `/ws/pty` (§12.1). Text frames are terminal output, except control
 * frames prefixed with `\u0000` (opened / exited / error). Input typed before the socket
 * opens is buffered. Closing only detaches; `kill` ends the process.
 */
export function openTerminalSocket(baseUrl: string, opts: OpenTerminalOptions): TerminalChannel {
  const params = new URLSearchParams();
  if (opts.sessionId) params.set("sessionId", opts.sessionId);
  if (opts.ptyId) params.set("ptyId", opts.ptyId);
  else if (opts.command) params.set("command", opts.command);
  const ws = new WebSocket(`${baseUrl}/ws/pty?${params}`);
  const dataListeners = new Set<(d: string) => void>();
  const eventListeners = new Set<(e: TerminalEvent) => void>();
  const pending: string[] = [];
  let opened = false;
  let size: { cols: number; rows: number } | undefined;

  const emit = (event: TerminalEvent) => {
    for (const l of eventListeners) l(event);
  };
  const send = (msg: unknown) => {
    const text = JSON.stringify(msg);
    if (opened && ws.readyState === WebSocket.OPEN) ws.send(text);
    else pending.push(text);
  };

  ws.onmessage = (e) => {
    const text = String(e.data);
    if (text.startsWith(TERMINAL_CONTROL_PREFIX)) {
      let parsed: TerminalServerMessage | undefined;
      try {
        parsed = TerminalServerMessage.parse(JSON.parse(text.slice(1)));
      } catch {
        return;
      }
      if (parsed.type === "opened") {
        opened = true;
        for (const p of pending.splice(0)) ws.send(p);
        if (size) ws.send(JSON.stringify({ type: "resize", ...size }));
        emit({ type: "opened", ptyId: parsed.ptyId, attached: parsed.attached });
      } else if (parsed.type === "exited") {
        emit({ type: "exited", exitCode: parsed.exitCode });
      } else {
        emit({ type: "error", message: parsed.message });
      }
      return;
    }
    for (const l of dataListeners) l(text);
  };
  ws.onclose = (e) => {
    if (!opened && e.code !== 1000) emit({ type: "error", message: "Terminal unavailable" });
  };

  return {
    write: (data) => send({ type: "input", data }),
    resize: (cols, rows) => {
      size = { cols, rows };
      if (opened) send({ type: "resize", cols, rows });
    },
    onData: (l) => {
      dataListeners.add(l);
      return () => dataListeners.delete(l);
    },
    onEvent: (l) => {
      eventListeners.add(l);
      return () => eventListeners.delete(l);
    },
    close: () => ws.close(1000),
    kill: () => {
      send({ type: "kill" });
      setTimeout(() => ws.close(1000), 100);
    },
  };
}
