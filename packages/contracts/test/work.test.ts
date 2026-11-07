import { describe, expect, it } from "vitest";
import {
  AutomationGuards,
  AutomationRun,
  ConflictDecision,
  Session,
  StartWorkResult,
  WorkKey,
  type WorkSummary,
} from "../src";
import { sampleSession, ts } from "./fixtures";

const summary: WorkSummary = {
  kind: "automation_run",
  id: "run-1",
  sessionId: "s9",
  projectId: "p1",
  startedBy: { kind: "automation", id: "a1" },
  purpose: "Nightly security audit",
  workKey: "automation:security-audit",
  scope: { projectId: "p1" },
  progress: { text: "Scanning dependencies", at: ts },
  status: "running",
  startedAt: ts,
};

const run = {
  id: "run-2",
  automationId: "a1",
  projectId: "p1",
  status: "skipped",
  triggeredBy: "cron",
  startedBy: { kind: "automation", id: "a1" },
  purpose: "Nightly security audit",
  workKey: "automation:security-audit",
  scope: { projectId: "p1" },
  progress: null,
  skipReason: "overlap",
  sessionId: null,
  startedAt: ts,
  finishedAt: ts,
  error: null,
};

describe("situational awareness (§8.4)", () => {
  it("validates work keys", () => {
    for (const key of ["automation:security-audit", "issue:142", "pr:57", "request:fix login"]) {
      expect(WorkKey.safeParse(key).success).toBe(true);
    }
    for (const key of ["", "issue", "Issue:1", ":x"]) {
      expect(WorkKey.safeParse(key).success).toBe(false);
    }
  });

  it("puts work fields on sessions", () => {
    const parsed = Session.parse(sampleSession);
    expect(parsed.workKey).toBe("issue:12");
    expect(parsed.startedBy.kind).toBe("pm");
    expect(Session.safeParse({ ...sampleSession, status: "queued" }).success).toBe(true);
  });

  it("round-trips start results", () => {
    const started = StartWorkResult.parse({ status: "started", sessionId: "s1" });
    expect(started.status).toBe("started");
    const conflict = StartWorkResult.parse({ status: "conflict", existing: [summary] });
    expect(conflict.status === "conflict" && conflict.existing[0]?.workKey).toBe(
      "automation:security-audit",
    );
    expect(StartWorkResult.safeParse({ status: "conflict", existing: [] }).success).toBe(false);
  });

  it("requires a reason to force", () => {
    expect(ConflictDecision.safeParse({ resolution: "force" }).success).toBe(false);
    expect(ConflictDecision.safeParse({ resolution: "force", reason: "  " }).success).toBe(false);
    expect(ConflictDecision.safeParse({ resolution: "force", reason: "urgent" }).success).toBe(
      true,
    );
    expect(ConflictDecision.safeParse({ resolution: "join", sessionId: "s9" }).success).toBe(true);
  });

  it("records skipped runs with a reason", () => {
    expect(AutomationRun.parse(run).skipReason).toBe("overlap");
    expect(AutomationRun.safeParse({ ...run, skipReason: null }).success).toBe(false);
    expect(AutomationRun.safeParse({ ...run, status: "running" }).success).toBe(false);
    expect(AutomationRun.safeParse({ ...run, status: "running", skipReason: null }).success).toBe(
      true,
    );
  });

  it("defaults the overlap policy to skip-if-running", () => {
    expect(AutomationGuards.parse({}).overlapPolicy).toBe("skip-if-running");
    expect(AutomationGuards.safeParse({ overlapPolicy: "queue" }).success).toBe(true);
    expect(AutomationGuards.safeParse({ overlapPolicy: "never" }).success).toBe(false);
  });
});
