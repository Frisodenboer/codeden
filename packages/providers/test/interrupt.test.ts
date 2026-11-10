import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Options, Query, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { AgentEvent, SessionOptions } from "@codeden/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeSession } from "../src/claude/session";
import { CodexSession } from "../src/codex/session";

const base: SessionOptions = {
  sessionId: "s1",
  role: "agent",
  cwd: tmpdir(),
  autonomy: "auto",
  mcpServers: [],
  additionalDirectories: [],
  planMode: false,
};

type InterruptOpts = { cancelQueued?: boolean } | undefined;

/**
 * A stand-in for the SDK's `query()` whose turns never finish on their own. It records the
 * prompts the session pushes and the options of each interrupt; `onInterrupt` decides the answer.
 */
function stubSdk(onInterrupt: (prompts: SDKUserMessage[]) => Promise<unknown>) {
  const prompts: SDKUserMessage[] = [];
  const interrupts: InterruptOpts[] = [];
  const query = ((params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    void (async () => {
      for await (const message of params.prompt) prompts.push(message);
    })();
    let finish = () => {};
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const q = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await done;
          return { done: true as const, value: undefined };
        },
      }),
      interrupt: (opts?: InterruptOpts) => {
        interrupts.push(opts);
        return onInterrupt(prompts);
      },
      supportedModels: async () => [],
      close: () => finish(),
    };
    return q as unknown as Query;
  }) as unknown as ConstructorParameters<typeof ClaudeSession>[1]["query"];
  return { query, prompts, interrupts };
}

const sessions: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  delete process.env.FAKE_CODEX_TURN;
});

function collect(events: AsyncIterable<AgentEvent>): AgentEvent[] {
  const seen: AgentEvent[] = [];
  void (async () => {
    for await (const e of events) seen.push(e);
  })();
  return seen;
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("Claude interrupt", () => {
  it("closes the turn when the CLI never answers the interrupt", async () => {
    const sdk = stubSdk(() => new Promise(() => {}));
    const session = new ClaudeSession(base, {
      executable: { kind: "native", path: "/bin/claude" } as never,
      query: sdk.query,
      interruptTimeoutMs: 30,
    });
    sessions.push(session);
    const events = collect(session.events);
    await session.send({ text: "go", attachments: [] });

    const started = Date.now();
    await session.interrupt();
    expect(Date.now() - started).toBeLessThan(2000);
    await settle();
    expect(events.filter((e) => e.type === "turn.interrupted")).toHaveLength(1);
    expect(sdk.interrupts).toEqual([{ cancelQueued: true }]);
    // The session can take the next turn.
    await session.send({ text: "again", attachments: [] });
  });

  it("cancels steered messages still queued and says so in the transcript", async () => {
    const sdk = stubSdk(async (prompts) => ({
      still_queued: [],
      cancelled: prompts.map((p) => p.uuid).filter((u): u is NonNullable<typeof u> => !!u),
    }));
    const session = new ClaudeSession(base, {
      executable: { kind: "native", path: "/bin/claude" } as never,
      query: sdk.query,
      interruptTimeoutMs: 30,
    });
    sessions.push(session);
    const events = collect(session.events);
    await session.send({ text: "go", attachments: [] });
    await session.steer({ text: "also this", attachments: [] });
    await settle();
    expect(sdk.prompts[1]?.uuid).toMatch(/^[0-9a-f-]{36}$/);

    await session.interrupt();
    const notice = events.find((e) => e.type === "item.completed" && e.item.kind === "notice");
    expect(notice).toMatchObject({ item: { code: "queued_messages_cancelled" } });
    await settle();
    await settle();
    expect(events.filter((e) => e.type === "turn.interrupted")).toHaveLength(1);
  });
});

describe("Codex interrupt", () => {
  it("closes the turn when app-server never answers turn/interrupt", async () => {
    process.env.FAKE_CODEX_TURN = "hang";
    const session = new CodexSession(base, {
      executable: {
        kind: "node-script",
        path: process.execPath,
        script: join(import.meta.dirname, "fixtures", "fake-codex", "app-server.mjs"),
      },
      interruptTimeoutMs: 50,
    });
    sessions.push(session);
    const events = collect(session.events);
    await session.start();
    await session.send({ text: "go", attachments: [] });
    const deadline = Date.now() + 5000;
    while (!events.some((e) => e.type === "turn.started")) {
      if (Date.now() > deadline) throw new Error("turn did not start");
      await settle();
    }

    const started = Date.now();
    await session.interrupt();
    expect(Date.now() - started).toBeLessThan(2000);
    await settle();
    expect(events.filter((e) => e.type === "turn.interrupted")).toHaveLength(1);
  });
});
