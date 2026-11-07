import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent, SessionOptions } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { ClaudeAdapter } from "../src/claude/adapter";
import { CodexAdapter } from "../src/codex/adapter";
import { ReplayProvider } from "../src/replay/adapter";
import { instantiateFixture, loadFixture } from "../src/replay/fixture";
import { validateEventStream } from "../src/replay/validate";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
const realCapabilities: Record<string, ReturnType<ClaudeAdapter["capabilities"]>> = {
  claude: new ClaudeAdapter().capabilities(),
  codex: new CodexAdapter().capabilities(),
};

const options = (cwd: string): SessionOptions => ({
  sessionId: "replay-1",
  role: "agent",
  cwd,
  autonomy: "auto",
  mcpServers: [],
  additionalDirectories: [],
  planMode: false,
});

describe("recorded fixtures", () => {
  it("covers both providers, approvals and subagents", () => {
    const fixtures = files.map((f) => loadFixture(path.join(dir, f)));
    expect(new Set(fixtures.map((f) => f.provider))).toEqual(new Set(["claude", "codex"]));
    const all = fixtures.flatMap((f) => f.turns.flatMap((t) => t.events));
    expect(all.some((e) => e.type === "item.started" && e.item.kind === "approval_request")).toBe(
      true,
    );
    expect(all.some((e) => e.type === "thread.started" && e.thread.parentThreadId)).toBe(true);
  });

  for (const file of files) {
    describe(file, () => {
      const fixture = loadFixture(path.join(dir, file));

      it("is a valid normalized event stream", () => {
        const events = [...fixture.preamble, ...fixture.turns.flatMap((t) => t.events)];
        expect(validateEventStream(events)).toEqual([]);
        for (const turn of fixture.turns) {
          const rootEnds = turn.events.filter(
            (e) => e.type === "turn.completed" && e.threadId === "<SESSION>:thread-root",
          );
          expect(rootEnds).toHaveLength(1);
        }
        expect(fixture.capabilities).toEqual(realCapabilities[fixture.provider]);
      });

      it("replays deterministically through the Replay provider", async () => {
        const cwd = path.join(path.sep, "replay", "work");
        const expected = instantiateFixture(fixture, cwd, "replay-1");
        const session = await new ReplayProvider(fixture).openSession(options(cwd));
        const seen: AgentEvent[] = [];
        const it = session.events[Symbol.asyncIterator]();
        for (const _ of expected.preamble) seen.push((await it.next()).value);
        for (const turn of expected.turns) {
          await session.send(turn.input);
          for (const _ of turn.events) {
            const { value } = await it.next();
            seen.push(value);
            if (value.type === "item.started" && "requestId" in value.item) {
              const recorded = turn.responses[value.item.requestId];
              await session.respond(value.item.requestId, recorded ?? { kind: "cancel" });
            }
          }
        }
        await session.close();
        expect(seen).toEqual([...expected.preamble, ...expected.turns.flatMap((t) => t.events)]);
        expect(session.resumeToken()).toBeTruthy();
        expect(JSON.stringify(seen)).not.toContain("<CWD>");
      });
    });
  }
});

describe("validateEventStream", () => {
  it("reports broken streams", () => {
    const thread = { type: "thread.started", thread: { id: "t" } };
    const problems = validateEventStream([
      thread,
      { type: "turn.started", threadId: "t", turnId: "a" },
      {
        type: "item.started",
        threadId: "t",
        turnId: "a",
        item: { id: "i", kind: "assistant_message", status: "in_progress", text: "" },
      },
      {
        type: "item.delta",
        threadId: "t",
        turnId: "a",
        itemId: "nope",
        delta: { type: "text", text: "x" },
      },
      { type: "turn.started", threadId: "t", turnId: "b" },
    ]);
    expect(problems.join("\n")).toMatch(/unknown item nope/);
    expect(problems.join("\n")).toMatch(/root turn started while a is open/);
    expect(problems.join("\n")).toMatch(/item i \(assistant_message\) never completed/);
  });

  it("supports interrupting a replayed turn", async () => {
    const fixture = loadFixture(
      path.join(dir, files.find((f) => f.includes("approval")) ?? files[0] ?? ""),
    );
    const session = await new ReplayProvider(fixture).openSession(options("/w"));
    await session.send(fixture.turns[0]?.input ?? { text: "x", attachments: [] });
    const events: AgentEvent[] = [];
    for await (const e of session.events) {
      events.push(e);
      if (e.type === "item.started" && e.item.kind === "approval_request")
        await session.interrupt();
      if (e.type === "turn.interrupted") break;
    }
    expect(events.at(-1)).toMatchObject({ type: "turn.interrupted", reason: "user" });
    await session.close();
  });
});
