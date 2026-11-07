import { describe, expect, it } from "vitest";
import {
  RUNNER_PROTOCOL_VERSION,
  RunnerCommand,
  RunnerCommandResults,
  RunnerLock,
  RunnerToServerMessage,
  ServerToRunnerMessage,
} from "../src";
import { sampleAgentEvents, ts } from "./fixtures";

function roundTrip<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  const first = schema.parse(value);
  expect(schema.parse(JSON.parse(JSON.stringify(first)))).toEqual(first);
  return first;
}

describe("runner protocol", () => {
  it("round-trips the handshake", () => {
    roundTrip(ServerToRunnerMessage, {
      type: "hello",
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      serverVersion: "0.0.0",
    });
    roundTrip(RunnerToServerMessage, {
      type: "welcome",
      protocolVersion: RUNNER_PROTOCOL_VERSION,
      runnerId: "runner-1",
      runnerVersion: "0.0.0",
      pid: 1234,
      startedAt: ts,
      capabilities: { pty: false, browser: false, git: false, mcpProxy: false },
      providers: [],
      sessions: [],
      journal: { lastSeq: 0, unacked: 0 },
      draining: false,
    });
    roundTrip(ServerToRunnerMessage, { type: "resume", lastAckedSeq: 0 });
    roundTrip(RunnerToServerMessage, {
      type: "reject",
      reason: "protocol_mismatch",
      message: "unsupported",
      supportedProtocolVersions: [1],
    });
  });

  it("round-trips commands and results", () => {
    const start = roundTrip(ServerToRunnerMessage, {
      type: "command",
      id: "req-1",
      command: {
        name: "session.start",
        sessionId: "s1",
        providerId: "fake",
        options: { sessionId: "s1", role: "agent", cwd: "/tmp", autonomy: "auto" },
        input: { text: "hi" },
      },
    });
    expect(start.type === "command" && start.command.name).toBe("session.start");
    roundTrip(RunnerToServerMessage, { type: "result", id: "req-1", ok: true, result: {} });
    roundTrip(RunnerToServerMessage, {
      type: "result",
      id: "req-2",
      ok: false,
      error: { code: "unknown_session", message: "nope" },
    });
  });

  it("has a result schema for every command", () => {
    const names = RunnerCommand.options.map((o) => o.shape.name.value);
    expect(Object.keys(RunnerCommandResults).sort()).toEqual([...names].sort());
  });

  it("round-trips durable events, streams and acks", () => {
    sampleAgentEvents.forEach((event, i) => {
      roundTrip(RunnerToServerMessage, {
        type: "event",
        seq: i + 1,
        ts,
        event: { kind: "agent", sessionId: "s1", event },
      });
    });
    roundTrip(RunnerToServerMessage, {
      type: "event",
      seq: 99,
      ts,
      event: { kind: "session.process", sessionId: "s1", state: "exited", exitCode: 0 },
    });
    roundTrip(RunnerToServerMessage, {
      type: "stream",
      ts,
      stream: { kind: "pty.output", ptyId: "p1", data: "$ ls\r\n" },
    });
    roundTrip(ServerToRunnerMessage, { type: "ack", seq: 99 });
    expect(ServerToRunnerMessage.safeParse({ type: "ack", seq: 0 }).success).toBe(false);
  });

  it("validates the lock file", () => {
    roundTrip(RunnerLock, {
      pid: 1,
      port: 40000,
      token: "a".repeat(32),
      version: "0.0.0",
      protocolVersion: 1,
      runnerId: "r",
      startedAt: ts,
    });
    expect(RunnerLock.safeParse({ pid: 1, port: 0 }).success).toBe(false);
  });
});
