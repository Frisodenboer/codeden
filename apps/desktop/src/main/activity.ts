import {
  ActivitySummary,
  InboxItemStatus,
  SessionStatus,
  Settings,
  summarizeActivity,
} from "@codeden/contracts";
import { z } from "zod";

export interface ServerStatus {
  connected: boolean;
  activity: ActivitySummary | null;
  settings: Settings | null;
}

export interface ActivityMonitorOptions {
  /** e.g. `http://127.0.0.1:4317`. */
  baseUrl: string;
  token: string;
  intervalMs?: number;
  fetch?: typeof fetch;
  onChange: (status: ServerStatus) => void;
}

/**
 * Polls the server for what the tray, badge, keep-awake and the desktop settings need:
 * `GET /api/activity` (falling back to the snapshot on an older server) and
 * `GET /api/settings`. Small loopback requests every few seconds; `onChange` fires only when
 * something changed.
 */
export class ActivityMonitor {
  private timer: NodeJS.Timeout | undefined;
  private last = "";
  private useSnapshot = false;
  status: ServerStatus = { connected: false, activity: null, settings: null };

  constructor(private readonly opts: ActivityMonitorOptions) {}

  start(): void {
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.opts.intervalMs ?? 3000);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Poll now (e.g. right after the window changed a setting). */
  async poll(): Promise<ServerStatus> {
    let next: ServerStatus;
    try {
      const [activity, settings] = await Promise.all([this.activity(), this.get("/api/settings")]);
      next = { connected: true, activity, settings: Settings.parse(settings) };
    } catch {
      next = { ...this.status, connected: false };
    }
    const key = JSON.stringify(next);
    this.status = next;
    if (key !== this.last) {
      this.last = key;
      this.opts.onChange(next);
    }
    return next;
  }

  private async activity(): Promise<ActivitySummary> {
    if (!this.useSnapshot) {
      try {
        return ActivitySummary.parse(await this.get("/api/activity"));
      } catch (error) {
        if (!(error instanceof NotFound)) throw error;
        this.useSnapshot = true; // a server from before /api/activity existed
      }
    }
    // Only the statuses matter, so other servers' extra or older fields don't get in the way.
    const snap = StatusesOnly.parse(await this.get("/api/snapshot"));
    return summarizeActivity(snap.sessions, snap.inbox);
  }

  private async get(path: string): Promise<unknown> {
    const res = await (this.opts.fetch ?? fetch)(`${this.opts.baseUrl}${path}`, {
      headers: { authorization: `Bearer ${this.opts.token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (res.status === 404) throw new NotFound();
    if (!res.ok) throw new Error(`${path}: ${res.status}`);
    return res.json();
  }
}

class NotFound extends Error {}

const StatusesOnly = z.object({
  sessions: z.array(z.object({ status: SessionStatus })),
  inbox: z.array(z.object({ status: InboxItemStatus })),
});
