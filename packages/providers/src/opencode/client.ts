import type {
  OcCommand,
  OcEvent,
  OcPartInput,
  OcPermissionRule,
  OcProvidersResponse,
  OcSession,
} from "./types";

/** Where a running `opencode serve` listens, and the Basic-auth password it was started with. */
export interface OpencodeEndpoint {
  url: string;
  password?: string;
  username?: string;
}

/** An HTTP error from the opencode server. */
export class OpencodeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    body: string,
  ) {
    super(`opencode ${path} answered ${status}${body ? `: ${body.slice(0, 300)}` : ""}`);
    this.name = "OpencodeHttpError";
  }
}

export interface PromptBody {
  parts: OcPartInput[];
  model?: { providerID: string; modelID: string };
  variant?: string;
  system?: string;
  agent?: string;
}

/**
 * A small typed client for the opencode server's v1 HTTP API (the endpoints the official
 * `@opencode-ai/sdk` wraps). Plain `fetch`, so no generated SDK has to match the installed
 * opencode exactly. Every call is scoped to a project `directory`, as opencode requires.
 */
export class OpencodeClient {
  constructor(
    private readonly endpoint: OpencodeEndpoint,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get url(): string {
    return this.endpoint.url;
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { accept: "application/json" };
    if (json) h["content-type"] = "application/json";
    if (this.endpoint.password) {
      const user = this.endpoint.username ?? "opencode";
      h.authorization = `Basic ${Buffer.from(`${user}:${this.endpoint.password}`).toString("base64")}`;
    }
    return h;
  }

  private href(path: string, directory?: string): string {
    const u = new URL(path, this.endpoint.url);
    if (directory) u.searchParams.set("directory", directory);
    return u.toString();
  }

  private async call<T>(
    method: string,
    path: string,
    opts: { directory?: string; body?: unknown; signal?: AbortSignal } = {},
  ): Promise<T> {
    const res = await this.fetchImpl(this.href(path, opts.directory), {
      method,
      headers: this.headers(opts.body !== undefined),
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    const text = await res.text();
    if (!res.ok) throw new OpencodeHttpError(res.status, path, text);
    return (text ? JSON.parse(text) : undefined) as T;
  }

  health(signal?: AbortSignal): Promise<{ healthy: boolean; version: string }> {
    return this.call("GET", "/global/health", { signal });
  }

  providers(directory?: string): Promise<OcProvidersResponse> {
    return this.call("GET", "/config/providers", { directory });
  }

  createSession(
    directory: string,
    body: { title?: string; permission?: OcPermissionRule[] },
  ): Promise<OcSession> {
    return this.call("POST", "/session", { directory, body });
  }

  /** Change a session's permission rules (resume, autonomy changes). */
  updateSession(
    directory: string,
    id: string,
    body: { title?: string; permission?: OcPermissionRule[] },
  ): Promise<OcSession> {
    return this.call("PATCH", `/session/${encodeURIComponent(id)}`, { directory, body });
  }

  /** Add (or replace) an MCP server for the project instance of `directory`. */
  addMcp(
    directory: string,
    name: string,
    config: Record<string, unknown>,
  ): Promise<Record<string, { status: string; error?: string }>> {
    return this.call("POST", "/mcp", { directory, body: { name, config } });
  }

  disconnectMcp(directory: string, name: string): Promise<unknown> {
    return this.call("POST", `/mcp/${encodeURIComponent(name)}/disconnect`, { directory });
  }

  /** opencode's slash commands for `directory` (its config, MCP prompts and skills). */
  commands(directory: string): Promise<OcCommand[]> {
    return this.call("GET", "/command", { directory });
  }

  getSession(directory: string, id: string): Promise<OcSession> {
    return this.call("GET", `/session/${encodeURIComponent(id)}`, { directory });
  }

  /** Start a turn without waiting for it (`prompt_async`); progress arrives on `/event`. */
  async prompt(directory: string, id: string, body: PromptBody): Promise<void> {
    await this.call("POST", `/session/${encodeURIComponent(id)}/prompt_async`, {
      directory,
      body,
    });
  }

  /** Run one of opencode's slash commands as a turn; progress arrives on `/event`. */
  async command(
    directory: string,
    id: string,
    body: {
      command: string;
      arguments: string;
      model?: string;
      variant?: string;
      parts?: Extract<OcPartInput, { type: "file" }>[];
    },
  ): Promise<void> {
    // The response is the finished message; the turn itself is followed on `/event`.
    await this.call("POST", `/session/${encodeURIComponent(id)}/command`, { directory, body });
  }

  abort(directory: string, id: string): Promise<boolean> {
    return this.call("POST", `/session/${encodeURIComponent(id)}/abort`, { directory });
  }

  replyPermission(
    directory: string,
    requestId: string,
    reply: "once" | "always" | "reject",
    message?: string,
  ): Promise<boolean> {
    return this.call("POST", `/permission/${encodeURIComponent(requestId)}/reply`, {
      directory,
      body: { reply, ...(message ? { message } : {}) },
    });
  }

  replyQuestion(directory: string, requestId: string, answers: string[][]): Promise<boolean> {
    return this.call("POST", `/question/${encodeURIComponent(requestId)}/reply`, {
      directory,
      body: { answers },
    });
  }

  rejectQuestion(directory: string, requestId: string): Promise<boolean> {
    return this.call("POST", `/question/${encodeURIComponent(requestId)}/reject`, { directory });
  }

  /**
   * Subscribe to the server-sent event stream of `directory` (`GET /event`). Calls `onEvent`
   * for every event until `signal` aborts or the stream ends; resolves then. Rejects when the
   * stream cannot be opened.
   */
  async events(
    directory: string,
    onEvent: (event: OcEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const res = await this.fetchImpl(this.href("/event", directory), {
      headers: { ...this.headers(false), accept: "text/event-stream" },
      signal,
    });
    if (!res.ok || !res.body) {
      throw new OpencodeHttpError(res.status, "/event", res.ok ? "no body" : await res.text());
    }
    const parser = new SseParser(onEvent);
    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parser.push(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      if (!signal.aborted) throw error;
    } finally {
      reader.releaseLock();
    }
  }
}

/** Splits a `text/event-stream` body into JSON events. Malformed events are skipped. */
export class SseParser {
  private buffer = "";

  constructor(private readonly onEvent: (event: OcEvent) => void) {}

  push(chunk: string): void {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    for (let end = this.buffer.indexOf("\n\n"); end >= 0; end = this.buffer.indexOf("\n\n")) {
      const block = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      // `/global/event` wraps events as `{ directory, payload }`; `/event` sends them bare.
      const event = (
        parsed && typeof parsed === "object" && "payload" in parsed
          ? (parsed as { payload: unknown }).payload
          : parsed
      ) as OcEvent;
      if (event && typeof event.type === "string") this.onEvent(event);
    }
  }
}
