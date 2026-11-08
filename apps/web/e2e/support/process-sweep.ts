/**
 * Test teardown helper: find (and stop) every process whose command line mentions a folder,
 * e.g. an isolated CodeDen home or a temp install. Runners are detached on purpose (they
 * outlive the server), so a test that stops early or races a restart can leave one behind;
 * sweeping by the temp folder catches them without touching anything else on the machine.
 */
import { execFileSync } from "node:child_process";

export interface SweptProcess {
  pid: number;
  command: string;
}

/** Processes (other than this one) whose command line contains `needle` (case-insensitive). */
export function processesMentioning(needle: string): SweptProcess[] {
  const want = needle.toLowerCase();
  let rows: SweptProcess[] = [];
  try {
    if (process.platform === "win32") {
      const script =
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine } | " +
        'ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }';
      const out = execFileSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        {
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 64 * 1024 * 1024,
        },
      );
      rows = parse(out);
    } else {
      rows = parse(
        execFileSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" }),
        /^\s*(\d+)\s+(.*)$/,
      );
    }
  } catch {
    return [];
  }
  return rows.filter((r) => r.pid !== process.pid && r.command.toLowerCase().includes(want));
}

function parse(out: string, re = /^(\d+)\t(.*)$/): SweptProcess[] {
  const rows: SweptProcess[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = re.exec(line);
    if (m) rows.push({ pid: Number(m[1]), command: m[2] as string });
  }
  return rows;
}

/** Kill every process mentioning `needle` (with its children on Windows). Returns what it killed. */
export function killProcessesMentioning(needle: string): SweptProcess[] {
  const found = processesMentioning(needle);
  for (const p of found) {
    try {
      if (process.platform === "win32") {
        execFileSync("taskkill", ["/pid", String(p.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        process.kill(p.pid, "SIGKILL");
      }
    } catch {
      // already gone
    }
  }
  return found;
}

/** Wait until nothing mentions `needle` any more, then kill whatever is left. */
export async function sweepProcesses(needle: string, graceMs = 10_000): Promise<SweptProcess[]> {
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (processesMentioning(needle).length === 0) return [];
    await new Promise((r) => setTimeout(r, 500));
  }
  return killProcessesMentioning(needle);
}
