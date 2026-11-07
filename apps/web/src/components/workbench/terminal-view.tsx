import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef } from "react";
import { useClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/stores/theme";

const themes = {
  dark: {
    background: "#14161b",
    foreground: "#d9dce3",
    cursor: "#f2b34b",
    selectionBackground: "#f2b34b40",
    black: "#1c1f26",
    green: "#7fd19b",
    cyan: "#7cc7e8",
    yellow: "#f2c66d",
    red: "#f28b82",
    blue: "#8ab4f8",
    magenta: "#c79bf2",
    white: "#d9dce3",
  },
  light: {
    background: "#fbfbfc",
    foreground: "#2a2e37",
    cursor: "#b4670e",
    selectionBackground: "#b4670e30",
    black: "#2a2e37",
    green: "#1f8a4c",
    cyan: "#1b7a9e",
    yellow: "#9a6a00",
    red: "#c2382f",
    blue: "#2b5fd9",
    magenta: "#8a3fc7",
    white: "#6b7280",
  },
};

/** Terminals opened per slot (`<session>:<slot>`), re-attached when the view remounts. */
const attached = new Map<string, string>();

/**
 * xterm.js wired to a `TerminalChannel` from the client (§12.1). Session terminals live in the
 * runner, so unmounting only detaches and the next mount re-attaches with its scrollback.
 * `ephemeral` terminals (setup sign-in) are killed on unmount instead.
 */
export function TerminalView({
  sessionId,
  command,
  className,
  slot = "panel",
  ephemeral = false,
}: {
  sessionId: string | null;
  command?: string;
  className?: string;
  /** Distinguishes several terminals of one session (panel, drawer). */
  slot?: string;
  ephemeral?: boolean;
}) {
  const client = useClient();
  const theme = useResolvedTheme();
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: theme is applied separately below.
  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      fontFamily: '"Geist Mono Variable", ui-monospace, monospace',
      fontSize: 12,
      lineHeight: 1.35,
      cursorBlink: true,
      scrollback: 5000,
      theme: themes[theme],
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    termRef.current = term;
    const key = `${sessionId ?? "home"}:${slot}`;
    const ptyId = ephemeral ? undefined : attached.get(key);
    const channel = client.openTerminal({ sessionId, command, ptyId });
    const offData = channel.onData((d) => term.write(d));
    const offEvent = channel.onEvent((e) => {
      if (e.type === "opened" && !ephemeral) attached.set(key, e.ptyId);
      if (e.type === "exited") {
        attached.delete(key);
        term.write("\r\n\x1b[2m[process exited]\x1b[0m\r\n");
      }
      if (e.type === "error") {
        if (ptyId) attached.delete(key);
        term.write(`\r\n\x1b[31m${e.message}\x1b[0m\r\n`);
      }
    });
    const offInput = term.onData((d) => channel.write(d));
    const resize = () => {
      try {
        fit.fit();
        channel.resize(term.cols, term.rows);
      } catch {
        // Hidden or zero-size container; ignore until visible.
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current);
    resize();
    return () => {
      observer.disconnect();
      offData();
      offEvent();
      offInput.dispose();
      if (ephemeral) channel.kill();
      else channel.close();
      term.dispose();
      termRef.current = null;
    };
  }, [client, sessionId, command, slot, ephemeral]);

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = themes[theme];
  }, [theme]);

  return (
    <div className={cn("h-full p-2", className)} style={{ background: themes[theme].background }}>
      <div ref={host} className="h-full w-full" data-testid="terminal" />
    </div>
  );
}
