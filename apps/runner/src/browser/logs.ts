import type { BrowserConsoleEntry, BrowserNetworkEntry } from "@codeden/contracts";
import type { Page, Request } from "playwright-core";

const MAX_TEXT = 4_000;

/** Fixed-size ring of entries with monotonic ids. */
class Ring<T extends { id: number }> {
  private readonly items: T[] = [];
  constructor(private readonly max: number) {}

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }

  query(filter: (item: T) => boolean, since: number | undefined, limit: number): T[] {
    const out = this.items.filter((i) => (since === undefined || i.id > since) && filter(i));
    return out.slice(-limit);
  }
}

export interface LogQuery {
  tabId?: string;
  since?: number;
  limit?: number;
}

/**
 * Bounded console and network logs for one session's tabs. Agents page through them
 * with `since` (the last id they saw).
 */
export class BrowserLogs {
  private nextId = 1;
  private readonly console: Ring<BrowserConsoleEntry>;
  private readonly network: Ring<BrowserNetworkEntry>;
  private readonly pending = new WeakMap<Request, { entry: BrowserNetworkEntry; start: number }>();

  constructor(maxEntries = 500) {
    this.console = new Ring(maxEntries);
    this.network = new Ring(maxEntries);
  }

  /** Start capturing a tab's console messages, page errors and requests. */
  attach(page: Page, tabId: string): void {
    page.on("console", (message) => {
      const location = message.location();
      this.console.push({
        id: this.nextId++,
        tabId,
        level: message.type(),
        text: clip(message.text()),
        ...(location.url ? { url: location.url, line: location.lineNumber } : {}),
        ts: new Date().toISOString(),
      });
    });
    page.on("pageerror", (error) => {
      this.console.push({
        id: this.nextId++,
        tabId,
        level: "pageerror",
        text: clip(error.stack ?? error.message),
        ts: new Date().toISOString(),
      });
    });
    page.on("request", (request) => {
      const entry: BrowserNetworkEntry = {
        id: this.nextId++,
        tabId,
        method: request.method(),
        url: clip(request.url()),
        resourceType: request.resourceType(),
        status: null,
        failure: null,
        ts: new Date().toISOString(),
        durationMs: null,
      };
      this.pending.set(request, { entry, start: performance.now() });
      this.network.push(entry);
    });
    page.on("response", (response) => {
      const pending = this.pending.get(response.request());
      if (pending) pending.entry.status = response.status();
    });
    page.on("requestfinished", (request) => this.finish(request, null));
    page.on("requestfailed", (request) =>
      this.finish(request, request.failure()?.errorText ?? "failed"),
    );
  }

  private finish(request: Request, failure: string | null): void {
    const pending = this.pending.get(request);
    if (!pending) return;
    pending.entry.durationMs = Math.round(performance.now() - pending.start);
    if (failure) {
      pending.entry.failure = failure;
      pending.entry.status = null;
    }
    this.pending.delete(request);
  }

  consoleEntries(query: LogQuery = {}): BrowserConsoleEntry[] {
    return this.console.query(byTab(query.tabId), query.since, query.limit ?? 200);
  }

  networkEntries(query: LogQuery = {}): BrowserNetworkEntry[] {
    // Copies, so later status updates don't mutate a result already handed out.
    return this.network
      .query(byTab(query.tabId), query.since, query.limit ?? 200)
      .map((e) => ({ ...e }));
  }
}

function byTab(tabId: string | undefined) {
  return (entry: { tabId: string }) => tabId === undefined || entry.tabId === tabId;
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}
