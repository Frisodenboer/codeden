import { mkdtempSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  AgentEvent,
  ItemOf,
  RuntimeResponse,
  SessionOptions,
  UserInput,
} from "@codeden/contracts";
import type { ProviderSession } from "../../src/adapter";

/** Live tests only run with CODEDEN_LIVE=1 (they spend real subscription usage). */
export const LIVE = process.env.CODEDEN_LIVE === "1";
export const LIVE_TIMEOUT = 300_000;

export function tempDir(prefix = "cd-live-"): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function sessionOptions(cwd: string, extra: Partial<SessionOptions> = {}): SessionOptions {
  return {
    sessionId: `live-${Math.random().toString(36).slice(2, 8)}`,
    role: "agent",
    cwd,
    autonomy: "auto",
    mcpServers: [],
    additionalDirectories: [],
    planMode: false,
    ...extra,
  };
}

type Answer = (item: ItemOf<"approval_request"> | ItemOf<"user_question">) => RuntimeResponse;

export interface TurnResult {
  events: AgentEvent[];
  end: AgentEvent;
  text: string;
  approvals: ItemOf<"approval_request">[];
}

/** Collects every event a session emits, across turns. */
export class Collector {
  readonly all: AgentEvent[] = [];
  private readonly iterator: AsyncIterator<AgentEvent>;

  constructor(private readonly session: ProviderSession) {
    this.iterator = session.events[Symbol.asyncIterator]();
  }

  /** Consume events until one matches (approvals are allowed). */
  async waitFor(match: (e: AgentEvent) => boolean): Promise<AgentEvent> {
    for (;;) {
      const next = await this.iterator.next();
      if (next.done) throw new Error("Event stream ended");
      const e = next.value;
      this.all.push(e);
      if (e.type === "item.started" && e.item.kind === "approval_request") {
        await this.session.respond(e.item.requestId, { kind: "approval", decision: "allow_once" });
      }
      if (match(e)) return e;
    }
  }

  /** Send input and consume events until the root turn ends, answering requests with `answer`. */
  async turn(
    input: string | UserInput,
    answer: Answer = () => ({ kind: "approval", decision: "allow_once" }),
  ): Promise<TurnResult> {
    const events: AgentEvent[] = [];
    const approvals: ItemOf<"approval_request">[] = [];
    await this.session.send(typeof input === "string" ? { text: input, attachments: [] } : input);
    for (;;) {
      const next = await this.iterator.next();
      if (next.done) throw new Error("Event stream ended before the turn did");
      const e = next.value;
      events.push(e);
      this.all.push(e);
      if (
        e.type === "item.started" &&
        (e.item.kind === "approval_request" || e.item.kind === "user_question")
      ) {
        if (e.item.kind === "approval_request") approvals.push(e.item);
        await this.session.respond(e.item.requestId, answer(e.item));
      }
      const rootEnd =
        (e.type === "turn.completed" ||
          e.type === "turn.failed" ||
          e.type === "turn.interrupted") &&
        e.threadId.endsWith(":thread-root");
      if (rootEnd) {
        const text = events
          .flatMap((x) =>
            x.type === "item.completed" &&
            x.item.kind === "assistant_message" &&
            x.threadId === e.threadId
              ? [x.item.text]
              : [],
          )
          .join("\n");
        return { events, end: e, text, approvals };
      }
    }
  }
}

/** A local HTTP endpoint that records requests, standing in for an MCP server. */
export async function requestRecorder(): Promise<{
  url: string;
  requests: { method?: string; url?: string; headers: IncomingHttpHeaders }[];
  close: () => Promise<void>;
}> {
  const requests: { method?: string; url?: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    req.resume();
    res.statusCode = 500;
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    requests,
    close: () => new Promise((r) => server.close(() => r())),
  };
}
