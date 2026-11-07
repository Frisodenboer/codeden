import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunnerEvent, RunnerEventMessage } from "@codeden/contracts";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../src/db/client";
import { rowToSession } from "../src/db/rows";
import { checkpoints, sessions } from "../src/db/schema";
import { ingestRunnerEvent } from "../src/events/ingest";
import { EventStore } from "../src/events/store";
import { mergeSetupStep } from "../src/events/workbench-projection";
import { Outbox } from "../src/services/sessions/outbox";
import { sampleSession } from "./helpers";

let dir: string;
let database: Database;
let store: EventStore;
let seq = 0;

beforeEach(() => {
  seq = 0;
  dir = mkdtempSync(join(tmpdir(), "codeden-revents-"));
  database = openDatabase(join(dir, "codeden.db"));
  store = new EventStore(database.db);
  store.append([{ type: "session.created", sessionId: "s1", payload: { session: sampleSession } }]);
});

afterEach(() => {
  database.close();
  rmSync(dir, { recursive: true, force: true });
});

const ingest = (event: RunnerEvent) => {
  const msg: RunnerEventMessage = {
    type: "event",
    seq: ++seq,
    ts: `2026-11-07T10:00:0${seq}.000Z`,
    event,
  };
  return ingestRunnerEvent(database.db, store, "r1", msg);
};
const session = () =>
  rowToSession(database.db.select().from(sessions).where(eq(sessions.id, "s1")).get() as never);
const startMeta = () =>
  database.db.select().from(sessions).where(eq(sessions.id, "s1")).get()?.startMeta;

describe("runner event mapping", () => {
  it("accumulates setup output per command in the session's start metadata", () => {
    ingest({ kind: "workspace.setup", sessionId: "s1", status: "running", command: "pnpm i" });
    ingest({
      kind: "workspace.setup",
      sessionId: "s1",
      status: "running",
      command: "pnpm i",
      output: "Lockfile ok\n",
    });
    ingest({
      kind: "workspace.setup",
      sessionId: "s1",
      status: "running",
      command: "pnpm i",
      output: "Done\n",
    });
    const done = ingest({
      kind: "workspace.setup",
      sessionId: "s1",
      status: "succeeded",
      command: "pnpm i",
    });
    expect(done.events.map((e) => e.type)).toEqual(["session.setup"]);
    expect(startMeta()?.setup).toEqual([
      expect.objectContaining({
        command: "pnpm i",
        status: "succeeded",
        output: "Lockfile ok\nDone\n",
      }),
    ]);
  });

  it("records checkpoints for diffs", () => {
    ingest({
      kind: "checkpoint.created",
      sessionId: "s1",
      index: 0,
      ref: "refs/codeden/checkpoints/s1/0",
      commit: "a".repeat(40),
    });
    ingest({
      kind: "checkpoint.created",
      sessionId: "s1",
      index: 1,
      ref: "refs/codeden/checkpoints/s1/1",
      commit: "b".repeat(40),
      turnId: "u1",
    });
    const rows = database.db.select().from(checkpoints).all();
    expect(rows.map((r) => [r.index, r.turnId])).toEqual([
      [0, null],
      [1, "u1"],
    ]);
  });

  it("keeps sessions resumable when the runner exits, interrupted when a turn was cut off", () => {
    ingest({
      kind: "session.process",
      sessionId: "s1",
      state: "exited",
      reason: "runner_exit",
      interruptedTurn: true,
    });
    expect(session().status).toBe("interrupted");
  });

  it("leaves an idle session idle on a runner exit, but stops it on a normal exit", () => {
    store.append([
      {
        type: "session.updated",
        sessionId: "s1",
        payload: { session: { ...sampleSession, status: "idle" } },
      },
    ]);
    ingest({ kind: "session.process", sessionId: "s1", state: "exited", reason: "runner_exit" });
    expect(session().status).toBe("idle");
    ingest({ kind: "session.process", sessionId: "s1", state: "exited", reason: "stopped" });
    expect(session().status).toBe("stopped");
  });

  it("announces drains and terminal exits", () => {
    expect(ingest({ kind: "runner.draining", reason: "upgrade" }).events[0]).toMatchObject({
      type: "runner.draining",
      payload: { runnerId: "r1", reason: "upgrade" },
    });
    expect(ingest({ kind: "pty.exited", ptyId: "p1", exitCode: 0 }).events[0]?.type).toBe(
      "pty.exited",
    );
  });
});

describe("setup step merging", () => {
  it("bounds the kept output to the tail", () => {
    const at = "2026-11-07T10:00:00.000Z";
    const steps = mergeSetupStep(
      [{ command: "x", status: "running", output: "a".repeat(15_990), updatedAt: at }],
      { command: "x", status: "running", output: "b".repeat(20), updatedAt: at },
    );
    expect(steps).toHaveLength(1);
    expect(steps[0]?.output.length).toBe(16_000);
    expect(steps[0]?.output.endsWith("b".repeat(20))).toBe(true);
  });
});

describe("Outbox", () => {
  it("persists queued messages through the event log", () => {
    const outbox = new Outbox(database.db, store);
    const first = outbox.push("s1", { text: "one", attachments: [] });
    outbox.push("s1", { text: "two", attachments: [] });
    // A fresh instance (as after a restart) sees the same queue.
    const reopened = new Outbox(database.db, store);
    expect(reopened.count("s1")).toBe(2);
    expect(reopened.peek("s1")?.input.text).toBe("one");
    expect(reopened.sessionsWithMessages()).toEqual(["s1"]);
    reopened.remove(first, "sent");
    expect(reopened.peek("s1")?.input.text).toBe("two");
    reopened.clear("s1");
    expect(reopened.count("s1")).toBe(0);
  });
});
