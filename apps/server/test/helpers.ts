import { agentEventToNewEvent, type NewEvent, type Session } from "@codeden/contracts";

const ts = "2026-11-07T10:00:00.000Z";

export const sampleSession: Session = {
  id: "s1",
  projectId: null,
  role: "agent",
  parentSessionId: null,
  startedBy: { kind: "user" },
  purpose: "Say hello",
  workKey: "request:hello",
  scope: { projectId: null },
  progress: null,
  title: null,
  provider: "fake",
  model: null,
  effort: null,
  autonomy: "auto",
  status: "running",
  cwd: "/tmp",
  worktreePath: null,
  branch: null,
  baseBranch: null,
  issue: null,
  pr: null,
  resumeToken: null,
  runnerId: null,
  automationRunId: null,
  rootThreadId: null,
  createdAt: ts,
  updatedAt: ts,
  endedAt: null,
};

/** A session row plus one streamed turn, as persisted events. */
export function sampleSessionEvent(): NewEvent[] {
  const a = (e: Parameters<typeof agentEventToNewEvent>[1]) => agentEventToNewEvent("s1", e);
  return [
    { type: "session.created", sessionId: "s1", payload: { session: sampleSession } },
    a({ type: "thread.started", thread: { id: "t1" } }),
    a({ type: "turn.started", threadId: "t1", turnId: "u1" }),
    a({
      type: "item.started",
      threadId: "t1",
      turnId: "u1",
      item: { id: "i1", kind: "assistant_message", status: "in_progress", text: "" },
    }),
    a({
      type: "item.delta",
      threadId: "t1",
      turnId: "u1",
      itemId: "i1",
      delta: { type: "text", text: "Hello " },
    }),
    a({
      type: "item.delta",
      threadId: "t1",
      turnId: "u1",
      itemId: "i1",
      delta: { type: "text", text: "world" },
    }),
    a({ type: "turn.completed", threadId: "t1", turnId: "u1" }),
  ];
}
