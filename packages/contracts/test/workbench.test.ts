import { describe, expect, it } from "vitest";
import {
  DiffResult,
  DiffScope,
  EventEnvelope,
  RestoreFilesRequest,
  RunnerCommand,
  RunnerEvent,
  SessionResult,
  TerminalClientMessage,
  TerminalQuery,
} from "../src";

const ts = "2026-11-07T10:00:00.000Z";
const roundTrip = <T>(schema: { parse: (v: unknown) => T }, value: T) =>
  expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);

describe("workbench contracts", () => {
  it("round-trips the new domain events", () => {
    const events = [
      { type: "runner.draining", payload: { runnerId: "r", reason: "upgrade" } },
      {
        type: "session.setup",
        payload: {
          sessionId: "s",
          step: { command: "pnpm i", status: "running", output: "ok", updatedAt: ts },
        },
      },
      {
        type: "checkpoint.created",
        payload: {
          checkpoint: {
            sessionId: "s",
            index: 1,
            ref: "refs/codeden/checkpoints/s/1",
            commit: "abc",
            turnId: "u1",
            createdAt: ts,
          },
        },
      },
      {
        type: "message.queued",
        payload: {
          message: {
            id: "m",
            sessionId: "s",
            input: { text: "hi", attachments: [] },
            createdAt: ts,
          },
        },
      },
      { type: "message.dequeued", payload: { sessionId: "s", messageId: "m", reason: "sent" } },
      { type: "pty.exited", payload: { ptyId: "p", exitCode: null } },
    ];
    for (const e of events)
      roundTrip(EventEnvelope, { seq: 1, sessionId: null, ts, ...e } as never);
  });

  it("carries runner exit reasons and the oneShot command", () => {
    roundTrip(RunnerEvent, {
      kind: "session.process",
      sessionId: "s",
      state: "exited",
      reason: "runner_exit",
      interruptedTurn: true,
    });
    roundTrip(RunnerCommand, { name: "provider.oneShot", providerId: "claude", prompt: "hi" });
  });

  it("validates diffs, restores, results and terminal messages", () => {
    roundTrip(DiffScope, { kind: "turn", turnId: "u1" });
    roundTrip(DiffResult, {
      scope: { kind: "session" },
      files: [{ path: "a.txt", change: "add", additions: 1, deletions: 0, patch: "+hi" }],
      turns: [{ id: "u1", index: 1, label: "Turn 1", at: ts }],
    });
    expect(RestoreFilesRequest.safeParse({}).success).toBe(false);
    expect(RestoreFilesRequest.safeParse({ turnId: "u1", index: 1 }).success).toBe(false);
    roundTrip(RestoreFilesRequest, { index: 0, paths: ["a.txt"] });
    roundTrip(SessionResult, { outcome: "success", summary: "Done", at: ts });
    roundTrip(TerminalClientMessage, { type: "resize", cols: 80, rows: 24 });
    expect(TerminalQuery.parse({ cols: "100" })).toEqual({ cols: 100, rows: 30 });
  });
});
