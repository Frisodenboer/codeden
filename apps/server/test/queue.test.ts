import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NewEvent, ProviderInfo, Session } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Database, openDatabase } from "../src/db/client";
import { EventStore } from "../src/events/store";
import { ServiceError } from "../src/services/errors";
import { Outbox } from "../src/services/sessions/outbox";
import { QueueService } from "../src/services/sessions/queue";
import { SessionRepo } from "../src/services/sessions/repo";
import type { SessionService } from "../src/services/sessions/session-service";
import { sampleSession } from "./helpers";

let dir: string;
let database: Database;
let store: EventStore;
let outbox: Outbox;

const openStore = (name: string) => {
  const db = openDatabase(join(dir, name));
  return { db, store: new EventStore(db.db) };
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeden-queue-"));
  ({ db: database, store } = openStore("codeden.db"));
  store.append([{ type: "session.created", sessionId: "s1", payload: { session: sampleSession } }]);
  outbox = new Outbox(database.db, store);
});

afterEach(() => {
  database.close();
  rmSync(dir, { recursive: true, force: true });
});

const text = (o: Outbox) => o.list("s1").map((m) => m.input.text);

/** A `QueueService` over the real outbox with a stub session service. */
function queueWith(opts: { steer?: () => Promise<void>; canSteer?: boolean; status?: string }) {
  const repo = new SessionRepo(database.db, store);
  if (opts.status) repo.update("s1", (s) => ({ ...s, status: opts.status as Session["status"] }));
  const sessions = {
    steer: vi.fn(opts.steer ?? (async () => {})),
    send: vi.fn(async () => ({ status: "sent" as const })),
    flushOutbox: vi.fn(async () => {}),
  };
  const providers = (): ProviderInfo[] =>
    [{ id: "fake", capabilities: { steer: opts.canSteer ?? true } }] as unknown as ProviderInfo[];
  const queue = new QueueService({
    outbox,
    repo,
    sessions: sessions as unknown as SessionService,
    artifacts: { artifactForPath: () => undefined },
    providers,
  });
  return { queue, sessions };
}

const expectError = (fn: () => unknown, status: number, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status, code });
    return;
  }
  throw new Error(`expected a ${status} ${code}`);
};

describe("Outbox", () => {
  it("lists messages in order with their sender; rows from older events are the user's", () => {
    outbox.push("s1", { text: "first", attachments: [] });
    outbox.push("s1", { text: "from the pm", attachments: [] }, "pm");
    // An event written before senders were recorded.
    store.append([
      {
        type: "message.queued",
        sessionId: "s1",
        payload: {
          message: {
            id: "old",
            sessionId: "s1",
            input: { text: "old", attachments: [] },
            createdAt: "2999-01-01T00:00:00.000Z",
          },
        },
      } as unknown as NewEvent,
    ]);
    expect(outbox.list("s1").map((m) => [m.input.text, m.from])).toEqual([
      ["first", "user"],
      ["from the pm", "pm"],
      ["old", "user"],
    ]);
    expect(outbox.peek("s1")?.input.text).toBe("first");
  });

  it("edits and deletes through events, and the projection rebuilds from the log", () => {
    const a = outbox.push("s1", { text: "a", attachments: [] });
    const b = outbox.push("s1", { text: "b", attachments: [] });
    outbox.push("s1", { text: "c", attachments: [] }, "orchestrator");
    outbox.edit(a, "a, edited");
    outbox.remove(b, "deleted");
    expect(text(outbox)).toEqual(["a, edited", "c"]);
    expect(outbox.dequeuedReason("s1", b.id)).toBe("deleted");
    expect(outbox.dequeuedReason("s1", "never")).toBeUndefined();

    // Replay the whole log into an empty database.
    const fresh = openStore("rebuilt.db");
    try {
      const log = store.listAfter(0, 10_000);
      fresh.store.append(
        log.map((e) => ({ type: e.type, sessionId: e.sessionId, payload: e.payload }) as NewEvent),
      );
      const rebuilt = new Outbox(fresh.db.db, fresh.store);
      expect(rebuilt.list("s1")).toEqual(outbox.list("s1"));
    } finally {
      fresh.db.close();
    }
  });

  it("clears a session's queue and reports what it dropped", () => {
    outbox.push("s1", { text: "a", attachments: [] });
    outbox.push("s1", { text: "b", attachments: [] });
    expect(outbox.clear("s1").map((m) => m.input.text)).toEqual(["a", "b"]);
    expect(outbox.count("s1")).toBe(0);
  });
});

describe("QueueService", () => {
  it("edits and deletes queued messages; empty edits are refused", () => {
    const { queue } = queueWith({});
    const a = outbox.push("s1", { text: "a", attachments: [] });
    const b = outbox.push("s1", { text: "b", attachments: [] });
    expect(queue.edit("s1", a.id, "a2").input.text).toBe("a2");
    expectError(() => queue.edit("s1", a.id, "   "), 400, "empty_message");
    queue.delete("s1", b.id);
    expect(queue.list("s1").map((m) => m.input.text)).toEqual(["a2"]);
  });

  it("answers 409 already_sent once delivery took the message, and never edits it", () => {
    const { queue } = queueWith({});
    const a = outbox.push("s1", { text: "a", attachments: [] });
    const b = outbox.push("s1", { text: "b", attachments: [] });
    // Delivery takes the message synchronously before it sends anything.
    outbox.remove(a, "sent");
    expectError(() => queue.edit("s1", a.id, "too late"), 409, "already_sent");
    expectError(() => queue.delete("s1", a.id), 409, "already_sent");
    queue.delete("s1", b.id);
    expectError(() => queue.delete("s1", b.id), 409, "no_longer_queued");
    expectError(() => queue.delete("s1", "nope"), 404, "queued_message_not_found");
    expect(outbox.list("s1")).toEqual([]);
  });

  it("send-now steers the running turn and takes the message out first", async () => {
    const { queue, sessions } = queueWith({ status: "running" });
    const a = outbox.push("s1", { text: "a", attachments: [] });
    outbox.push("s1", { text: "b", attachments: [] });
    await expect(queue.sendNow("s1", a.id)).resolves.toEqual({ status: "steered" });
    expect(sessions.steer).toHaveBeenCalledWith("s1", a.input);
    expect(text(outbox)).toEqual(["b"]);
    expect(outbox.dequeuedReason("s1", a.id)).toBe("sent");
  });

  it("send-now puts the message back in its place when steering fails", async () => {
    const { queue } = queueWith({
      status: "running",
      steer: async () => {
        // While the steer is in flight, the message is gone: a racing edit gets 409.
        expectError(() => queue.edit("s1", a.id, "x"), 409, "already_sent");
        throw new Error("runner gone");
      },
    });
    const a = outbox.push("s1", { text: "a", attachments: [] });
    outbox.push("s1", { text: "b", attachments: [] });
    await expect(queue.sendNow("s1", a.id)).rejects.toThrow("runner gone");
    expect(text(outbox)).toEqual(["a", "b"]);
  });

  it("send-now sends straight away when idle, and refuses providers that cannot steer", async () => {
    const idle = queueWith({ status: "idle" });
    const a = outbox.push("s1", { text: "a", attachments: [] }, "pm");
    await expect(idle.queue.sendNow("s1", a.id)).resolves.toEqual({ status: "sent" });
    expect(idle.sessions.send).toHaveBeenCalledWith(
      "s1",
      { input: a.input, whenBusy: "queue" },
      "pm",
    );

    const noSteer = queueWith({ status: "running", canSteer: false });
    const b = outbox.push("s1", { text: "b", attachments: [] });
    await expect(noSteer.queue.sendNow("s1", b.id)).rejects.toMatchObject({
      status: 409,
      code: "unsupported",
    });
    expect(text(outbox)).toEqual(["b"]);
  });
});
