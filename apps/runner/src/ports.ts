import { execFile } from "node:child_process";
import { connect } from "node:net";
import type { RunnerCommandResult } from "@codeden/contracts";
import { listDescendants } from "./process/tree";

type PortList = RunnerCommandResult<"ports.list">["ports"];

export interface ListeningSocket {
  port: number;
  pid: number;
  /** Bound address, e.g. `127.0.0.1`, `0.0.0.0`, `::`. */
  address: string;
}

const LOCAL = new Set(["127.0.0.1", "0.0.0.0", "::", "::1", "*", "[::]", "[::1]"]);

/**
 * Parse `netstat -ano` (Windows) listening rows. Matched by the unconnected remote address
 * rather than the state word, which Windows localizes.
 */
export function parseNetstat(output: string): ListeningSocket[] {
  const out: ListeningSocket[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /^\s*TCP\s+(\S+):(\d+)\s+(?:0\.0\.0\.0:0|\[::\]:0)\s+\S+\s+(\d+)\s*$/i.exec(line);
    if (!m) continue;
    out.push({ address: m[1] as string, port: Number(m[2]), pid: Number(m[3]) });
  }
  return out;
}

/** Parse `lsof -nP -iTCP -sTCP:LISTEN -F pn` field output. */
export function parseLsof(output: string): ListeningSocket[] {
  const out: ListeningSocket[] = [];
  let pid = 0;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) pid = Number(line.slice(1));
    else if (line.startsWith("n")) {
      const m = /^n(.*):(\d+)$/.exec(line);
      if (m) out.push({ address: m[1] as string, port: Number(m[2]), pid });
    }
  }
  return out;
}

function exec(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 10_000 }, (error, stdout) =>
      resolve(error && !stdout ? "" : stdout),
    );
  });
}

/** Listening TCP sockets on this machine reachable from localhost. */
export async function listeningSockets(): Promise<ListeningSocket[]> {
  const all =
    process.platform === "win32"
      ? parseNetstat(await exec("netstat", ["-ano"]))
      : parseLsof(await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pn"]));
  return all.filter((s) => LOCAL.has(s.address));
}

/** True when something accepts TCP connections on 127.0.0.1:port. */
export function probePort(port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/**
 * Dev-server discovery (§12.2): listening localhost ports owned by processes this runner
 * started (terminals, setup scripts, agents and their children), plus any `probe` ports
 * (e.g. the `devServer.port` from `.codeden/project.json`) that accept connections.
 */
export async function listPorts(probe: number[] = []): Promise<PortList> {
  const [sockets, descendants] = await Promise.all([
    listeningSockets(),
    listDescendants(process.pid).catch(() => [] as number[]),
  ]);
  const ours = new Set(descendants);
  const byPort = new Map<number, number | null>();
  for (const s of sockets) if (ours.has(s.pid) && !byPort.has(s.port)) byPort.set(s.port, s.pid);
  for (const port of probe) {
    if (byPort.has(port)) continue;
    if (await probePort(port)) {
      byPort.set(port, sockets.find((s) => s.port === port)?.pid ?? null);
    }
  }
  return [...byPort.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([port, pid]) => ({ port, pid, url: `http://localhost:${port}` }));
}
