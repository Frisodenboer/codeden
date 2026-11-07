import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AGENT_EVENT_TYPES,
  AgentEvent,
  Automation,
  agentEventToNewEvent,
  ClientToServerMessage,
  CODEDEN_VERSION,
  defaultSettings,
  EventEnvelope,
  InboxItem,
  Item,
  isAgentEnvelope,
  Project,
  ProviderStatus,
  RuntimeResponse,
  ServerToClientMessage,
  Session,
  SessionOptions,
  Settings,
  Snapshot,
} from "../src";
import {
  sampleAgentEvents,
  sampleAutomation,
  sampleInboxItem,
  sampleProject,
  sampleSession,
  ts,
} from "./fixtures";

/** Parse, serialize to JSON and parse again; the result must be stable. */
function roundTrip<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  const first = schema.parse(value);
  const second = schema.parse(JSON.parse(JSON.stringify(first)));
  expect(second).toEqual(first);
  return second;
}

describe("agent events", () => {
  it("round-trips one of every event type", () => {
    for (const event of sampleAgentEvents) roundTrip(AgentEvent, event);
    const covered = new Set(sampleAgentEvents.map((e) => e.type));
    expect([...covered].sort()).toEqual([...AGENT_EVENT_TYPES].sort());
  });

  it("narrows tool calls by toolKind", () => {
    const item = Item.parse({
      id: "i1",
      kind: "tool_call",
      toolKind: "command",
      status: "in_progress",
      toolName: "Bash",
      command: "ls",
    });
    expect(item.kind === "tool_call" && item.toolKind === "command" && item.command).toBe("ls");
  });

  it("rejects a tool call missing its kind-specific fields", () => {
    const bad = { id: "i", kind: "tool_call", toolKind: "command", status: "completed" };
    expect(Item.safeParse({ ...bad, toolName: "Bash" }).success).toBe(false);
  });

  it("applies defaults to approvals, questions and inputs", () => {
    const approval = Item.parse({
      id: "a",
      kind: "approval_request",
      status: "in_progress",
      requestId: "r",
      action: "command",
      title: "Run rm -rf build",
    });
    expect(approval.kind === "approval_request" && approval.options).toEqual([
      "allow_once",
      "allow_session",
      "deny",
    ]);
    const msg = Item.parse({
      id: "m",
      kind: "user_message",
      status: "completed",
      input: { text: "hi" },
    });
    expect(msg.kind === "user_message" && msg.input.attachments).toEqual([]);
  });

  it("limits followups to four suggestions", () => {
    const suggestions = Array.from({ length: 5 }, (_, i) => ({ prompt: `p${i}` }));
    const result = Item.safeParse({
      id: "f",
      kind: "followups",
      status: "completed",
      source: "utility",
      suggestions,
    });
    expect(result.success).toBe(false);
  });
});

describe("persisted events", () => {
  it("wraps agent events as agent.<type> envelopes", () => {
    for (const event of sampleAgentEvents) {
      const envelope = roundTrip(EventEnvelope, {
        ...agentEventToNewEvent("s1", event),
        seq: 1,
        ts,
      });
      expect(envelope.type).toBe(`agent.${event.type}`);
      expect(isAgentEnvelope(envelope)).toBe(true);
    }
  });

  it("round-trips domain events", () => {
    const events = [
      { type: "project.created", sessionId: null, payload: { project: sampleProject } },
      { type: "session.created", sessionId: "s1", payload: { session: sampleSession } },
      { type: "inbox.created", sessionId: "s1", payload: { item: sampleInboxItem } },
      { type: "automation.saved", sessionId: null, payload: { automation: sampleAutomation } },
      { type: "settings.updated", sessionId: null, payload: { settings: defaultSettings() } },
      {
        type: "runner.connected",
        sessionId: null,
        payload: { runnerId: "r", version: "0.0.0", protocolVersion: 1 },
      },
    ];
    events.forEach((e, i) => {
      const envelope = roundTrip(EventEnvelope, { ...e, seq: i + 1, ts });
      expect(isAgentEnvelope(envelope)).toBe(false);
    });
  });

  it("requires a session id on agent events", () => {
    const result = EventEnvelope.safeParse({
      ...agentEventToNewEvent("s1", sampleAgentEvents[0] as AgentEvent),
      sessionId: null,
      seq: 1,
      ts,
    });
    expect(result.success).toBe(false);
  });
});

describe("entities", () => {
  it("round-trips projects, sessions, inbox items and automations", () => {
    roundTrip(Project, sampleProject);
    roundTrip(Project, { ...sampleProject, kind: "local", github: undefined });
    roundTrip(Session, sampleSession);
    roundTrip(InboxItem, sampleInboxItem);
    roundTrip(Automation, sampleAutomation);
  });

  it("requires github coordinates on github projects", () => {
    const { github: _github, ...rest } = sampleProject as Extract<
      typeof sampleProject,
      { kind: "github" }
    >;
    expect(Project.safeParse(rest).success).toBe(false);
  });

  it("fills automation guard defaults and keeps automations off", () => {
    const { guards: _guards, enabled: _enabled, ...rest } = sampleAutomation;
    const parsed = Automation.parse(rest);
    expect(parsed.enabled).toBe(false);
    expect(parsed.guards).toEqual({
      noOverlap: true,
      maxConcurrent: 1,
      maxPerDay: null,
      quietHours: null,
      catchUpMissed: false,
    });
  });
});

describe("settings", () => {
  it("parses an empty object into complete defaults", () => {
    const s = Settings.parse({});
    expect(s.autonomy.default).toBe("auto");
    expect(s.voice.readAloud.enabled).toBe(false);
    expect(s.imageGeneration.engine).toBe("auto");
    expect(s.utilityModel.jobs.followups).toBe(true);
    expect(s.providers.agent.provider).toBe("auto");
    roundTrip(Settings, s);
  });

  it("keeps provided values and fills siblings", () => {
    const s = Settings.parse({ voice: { readAloud: { enabled: true } } });
    expect(s.voice.readAloud.enabled).toBe(true);
    expect(s.voice.readAloud.engine).toBe("browser");
    expect(s.voice.dictation.engine).toBe("browser");
  });
});

describe("provider contracts", () => {
  it("round-trips session options, statuses and responses", () => {
    const opts = roundTrip(SessionOptions, {
      sessionId: "s1",
      role: "agent",
      cwd: "/tmp/x",
      autonomy: "auto",
      mcpServers: [{ transport: "http", name: "codeden", url: "http://127.0.0.1:1234/mcp" }],
    });
    expect(opts.planMode).toBe(false);
    roundTrip(ProviderStatus, {
      providerId: "claude",
      installed: true,
      version: "2.1.0",
      executablePath: "/usr/bin/claude",
      loggedIn: false,
      authMethod: null,
      account: null,
      loginExpiresAt: null,
      supported: true,
      issues: [
        {
          code: "not_logged_in",
          message: "Not logged in",
          fix: { kind: "login", command: "claude auth login" },
        },
      ],
      checkedAt: ts,
    });
    roundTrip(RuntimeResponse, { kind: "approval", decision: "deny", message: "no" });
    roundTrip(RuntimeResponse, { kind: "answer", answers: { q1: ["SQLite"] } });
  });
});

describe("ui websocket", () => {
  it("round-trips client and server messages", () => {
    roundTrip(ClientToServerMessage, { type: "subscribe", fromSeq: 0 });
    roundTrip(ServerToClientMessage, {
      type: "events",
      events: [{ seq: 1, sessionId: null, type: "future.event", payload: { x: 1 }, ts }],
    });
    roundTrip(ServerToClientMessage, { type: "resync", reason: "gap", seq: 10 });
  });

  it("round-trips a snapshot", () => {
    roundTrip(Snapshot, {
      seq: 3,
      serverVersion: CODEDEN_VERSION,
      generatedAt: ts,
      settings: defaultSettings(),
      projects: [sampleProject],
      sessions: [sampleSession],
      inbox: [sampleInboxItem],
      automations: [sampleAutomation],
      runner: {
        state: "connected",
        runnerId: "r",
        version: "0.0.0",
        providers: [],
        lastError: null,
      },
    });
  });
});

describe("version", () => {
  it("matches the published codeden package version", () => {
    const pkgUrl = new URL("../../../apps/cli/package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(pkgUrl, "utf8")) as { version: string };
    expect(CODEDEN_VERSION).toBe(pkg.version);
  });
});
