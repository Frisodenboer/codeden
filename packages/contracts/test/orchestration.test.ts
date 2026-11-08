import { describe, expect, it } from "vitest";
import {
  ArchiveSessionRequest,
  ArchiveSessionResponse,
  ConflictRecord,
  EventEnvelope,
  InboxItemKind,
  Notice,
  NoticeBatchData,
  Overview,
  RoleMessageRequest,
  RunnerCommand,
  Session,
  SessionOptions,
  Settings,
  Snapshot,
  StartWorkResult,
  UpdateSessionRequest,
  type WorkSummary,
  WorktreeCleanupOutcome,
} from "../src";
import { sampleSession, ts } from "./fixtures";

const work: WorkSummary = {
  kind: "session",
  id: "s1",
  sessionId: "s1",
  projectId: "p1",
  startedBy: { kind: "automation", id: "a1" },
  purpose: "Security audit",
  workKey: "automation:security-audit",
  scope: { projectId: "p1" },
  progress: null,
  status: "running",
  startedAt: ts,
};

const notice: Notice = {
  id: "n1",
  type: "conflict",
  projectId: "p1",
  target: "pm",
  sessionId: "s1",
  title: "Conflict: Security audit",
  createdAt: ts,
  deliveredAt: null,
  data: {
    conflictId: "c1",
    workKey: "automation:security-audit",
    purpose: "Security audit",
    requestedBy: { kind: "user" },
    existing: [work],
  },
};

describe("orchestration contracts (§8)", () => {
  it("round-trips typed notices, batches and their events", () => {
    expect(Notice.parse(notice)).toEqual(notice);
    expect(NoticeBatchData.parse({ notices: [notice] })).toEqual({ notices: [notice] });
    const event = { seq: 1, sessionId: null, ts, type: "notice.created", payload: { notice } };
    expect(EventEnvelope.parse(event)).toEqual(event);
    const delivered = {
      seq: 2,
      sessionId: null,
      ts,
      type: "notice.delivered",
      payload: { noticeIds: ["n1"], at: ts },
    };
    expect(EventEnvelope.parse(delivered)).toEqual(delivered);
    expect(() => Notice.parse({ ...notice, type: "session.failed" })).toThrow();
  });

  it("round-trips the GitHub notices (§8.2, §9)", () => {
    const base = { projectId: "p1", target: "pm", createdAt: ts, deliveredAt: null } as const;
    const pr = { number: 7, url: "https://github.com/o/r/pull/7", state: "open" } as const;
    const list: Notice[] = [
      {
        ...base,
        id: "n2",
        type: "pr.checks_passed",
        sessionId: "s1",
        title: "Checks passed",
        data: { sessionId: "s1", pr },
      },
      {
        ...base,
        id: "n3",
        type: "pr.merged",
        sessionId: null,
        title: "Merged",
        data: { sessionId: null, pr: { ...pr, state: "merged" }, linkedIssues: [3] },
      },
      {
        ...base,
        id: "n4",
        type: "review.submitted",
        sessionId: "s1",
        title: "Review",
        data: { sessionId: "s1", pr, reviewer: "ana", state: "changes_requested", body: "Fix" },
      },
      {
        ...base,
        id: "n5",
        type: "issue.opened",
        sessionId: null,
        title: "Issue #3",
        data: {
          issue: { number: 3, url: "https://github.com/o/r/issues/3", title: "Bug" },
          author: null,
          labels: ["bug"],
        },
      },
    ];
    for (const n of list) expect(Notice.parse(n)).toEqual(n);
    expect(() => Notice.parse({ ...list[3], type: "pr.merged" })).toThrow();
  });

  it("round-trips conflict records and the conflict inbox kind", () => {
    const record: ConflictRecord = {
      id: "conflict:1",
      projectId: "p1",
      request: {
        purpose: "Audit",
        workKey: "automation:security-audit",
        startedBy: { kind: "user" },
      },
      existing: [work],
      start: { projectId: "p1", role: "agent" },
      status: "open",
      resolution: null,
      outcome: null,
      createdAt: ts,
      resolvedAt: null,
    };
    expect(ConflictRecord.parse(record)).toEqual(record);
    expect(InboxItemKind.parse("conflict")).toBe("conflict");
    expect(
      StartWorkResult.parse({ status: "conflict", existing: [work], conflictId: "conflict:1" }),
    ).toMatchObject({ conflictId: "conflict:1" });
  });

  it("defaults role sessions in the snapshot and validates the HTTP shapes", () => {
    const overview: Overview = { generatedAt: ts, projects: [], sharedWork: [], pmMessages: [] };
    expect(Overview.parse(overview)).toEqual(overview);
    expect(Snapshot.shape.roleSessions.parse(undefined)).toBeUndefined();
    expect(RoleMessageRequest.parse({ input: { text: "hi" } })).toEqual({
      input: { text: "hi", attachments: [] },
      whenBusy: "queue",
    });
    expect(UpdateSessionRequest.parse({ model: null })).toEqual({ model: null });
    expect(() => UpdateSessionRequest.parse({})).toThrow();
  });

  it("carries readOnly and session.configure for role sessions", () => {
    const opts = SessionOptions.parse({
      sessionId: "pm1",
      role: "pm",
      cwd: "/r",
      autonomy: "auto",
      readOnly: true,
    });
    expect(opts.readOnly).toBe(true);
    expect(
      RunnerCommand.parse({
        name: "session.configure",
        sessionId: "s1",
        model: "m",
        effort: "high",
      }),
    ).toEqual({ name: "session.configure", sessionId: "s1", model: "m", effort: "high" });
  });
});

describe("session archive and worktree cleanup (§9)", () => {
  it("round-trips the archive shapes and the cleanup fields on a session", () => {
    expect(ArchiveSessionRequest.parse({})).toEqual({ force: false });
    const archived = {
      ...sampleSession,
      archivedAt: "2026-11-08T10:00:00.000Z",
      worktreeRemovedAt: "2026-11-08T10:00:01.000Z",
    };
    const response = ArchiveSessionResponse.parse({
      session: archived,
      worktree: { status: "kept_changes", message: "Uncommitted changes" },
    });
    expect(ArchiveSessionResponse.parse(JSON.parse(JSON.stringify(response)))).toEqual(response);
    expect(response.session.worktreeRemovedAt).toBe(archived.worktreeRemovedAt);
    // Sessions written before cleanup existed have neither field.
    expect(Session.parse(sampleSession).archivedAt).toBeUndefined();
    expect(() => WorktreeCleanupOutcome.parse({ status: "gone", message: null })).toThrow();
  });

  it("defaults worktree cleanup on, after a week", () => {
    const s = Settings.parse({});
    expect(s.worktrees).toEqual({ cleanup: true, afterDays: 7 });
    expect(() => Settings.parse({ worktrees: { afterDays: 0 } })).toThrow();
  });
});
