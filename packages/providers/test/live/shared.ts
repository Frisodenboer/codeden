import { existsSync } from "node:fs";
import path from "node:path";
import type { SessionOptions } from "@codeden/contracts";
import { expect } from "vitest";
import type { ProviderAdapter } from "../../src/adapter";
import { Collector, sessionOptions, tempDir } from "./helpers";

const isRootEnd = (type: string, threadId: string) =>
  (type === "turn.completed" || type === "turn.failed" || type === "turn.interrupted") &&
  threadId.endsWith(":thread-root");

/** Start a long turn, interrupt it once it is working, and expect `turn.interrupted`. */
export async function checkInterrupt(
  adapter: ProviderAdapter,
  extra: Partial<SessionOptions>,
): Promise<void> {
  const session = await adapter.openSession(sessionOptions(tempDir(), extra));
  try {
    const c = new Collector(session);
    await session.send({
      text: "Write a numbered list of 200 short facts about the ocean, one per line. Do not use any tools.",
      attachments: [],
    });
    await c.waitFor(
      (e) =>
        e.type === "item.delta" || (e.type === "item.started" && e.item.kind !== "user_message"),
    );
    await session.interrupt();
    const end = await c.waitFor((e) => "threadId" in e && isRootEnd(e.type, e.threadId));
    expect(end.type).toBe("turn.interrupted");
    // The session stays usable after an interrupt.
    const r = await c.turn("Reply with exactly: ok");
    expect(r.end.type).toBe("turn.completed");
  } finally {
    await session.close();
  }
}

/** Steer a running turn with extra work and expect both pieces of work to land. */
export async function checkSteer(
  adapter: ProviderAdapter,
  extra: Partial<SessionOptions>,
): Promise<void> {
  const cwd = tempDir();
  const session = await adapter.openSession(sessionOptions(cwd, extra));
  try {
    const c = new Collector(session);
    await session.send({
      text: "Create a.txt containing a. Then run the shell command `echo step-two`. Then tell me you're done.",
      attachments: [],
    });
    await c.waitFor((e) => e.type === "item.started" && e.item.kind === "tool_call");
    expect(session.steer).toBeDefined();
    await session.steer?.({
      text: "Additional request: before you finish, also create b.txt in the current directory containing b.",
      attachments: [],
    });
    const end = await c.waitFor((e) => "threadId" in e && isRootEnd(e.type, e.threadId));
    expect(end.type).toBe("turn.completed");
    expect(existsSync(path.join(cwd, "a.txt"))).toBe(true);
    expect(existsSync(path.join(cwd, "b.txt"))).toBe(true);
  } finally {
    await session.close();
  }
}
