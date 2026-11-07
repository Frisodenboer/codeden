import type {
  BrowserOpenResponse,
  BrowserTabsResponse,
  DevServer,
  RunnerCommandName,
  RunnerCommandOf,
  RunnerCommandResult,
} from "@codeden/contracts";
import { ServiceError } from "../errors";
import { type RunnerPort, runnerErrorCode, toServiceError } from "../runner-port";
import type { SessionRepo } from "../sessions/repo";

export interface BrowserServiceDeps {
  runner: RunnerPort;
  repo: SessionRepo;
}

/** Navigation and agent actions can wait on slow pages; leave headroom over the runner's 30s. */
const BROWSER_TIMEOUT_MS = 60_000;

/** True when a runner failure means the session has no browser open yet. */
export function isBrowserNotOpen(error: unknown): boolean {
  return (
    runnerErrorCode(error) === "not_found" ||
    (error instanceof ServiceError && error.code === "browser_not_open")
  );
}

/**
 * The session browser (§12.2) for the panel routes, the `/ws/browser` channel and the agent
 * tools. Every call names the session it acts for, so nobody can reach another session's
 * context; the runner enforces the same isolation.
 */
export class BrowserService {
  constructor(private readonly deps: BrowserServiceDeps) {}

  /** Send a `browser.*` command for an existing session, mapping runner failures. */
  async command<N extends Extract<RunnerCommandName, `browser.${string}`>>(
    command: RunnerCommandOf<N>,
    timeoutMs = BROWSER_TIMEOUT_MS,
  ): Promise<RunnerCommandResult<N>> {
    this.deps.repo.get((command as { sessionId: string }).sessionId);
    try {
      return await this.deps.runner.request(command, timeoutMs);
    } catch (error) {
      if (runnerErrorCode(error) === "not_found") {
        throw new ServiceError(
          409,
          "browser_not_open",
          error instanceof Error ? error.message : "The browser is not open",
        );
      }
      throw toServiceError(error);
    }
  }

  async open(sessionId: string, url?: string): Promise<BrowserOpenResponse> {
    const result = await this.command({ name: "browser.open", sessionId, url });
    return { cdpUrl: result.cdpUrl, tabs: result.tabs ?? [] };
  }

  /** The session's tabs; `open: false` when it has no browser yet (never throws for that). */
  async tabs(sessionId: string): Promise<BrowserTabsResponse> {
    try {
      const { tabs } = await this.command({ name: "browser.tabs.list", sessionId });
      return { open: true, tabs };
    } catch (error) {
      if (isBrowserNotOpen(error)) return { open: false, tabs: [] };
      throw error;
    }
  }

  /** Open the browser if needed, then navigate the active tab. */
  async navigate(sessionId: string, url: string, tabId?: string) {
    if (!(await this.tabs(sessionId)).open) await this.open(sessionId);
    return this.command({ name: "browser.navigate", sessionId, url, tabId });
  }

  /** Local dev servers the runner can see (its own descendants plus probed ports). */
  async devServers(probe?: number[]): Promise<DevServer[]> {
    try {
      const { ports } = await this.deps.runner.request({ name: "ports.list", probe }, 20_000);
      return ports;
    } catch (error) {
      throw toServiceError(error);
    }
  }
}
