import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentEvent, agentEventToNewEvent, type Item } from "@codeden/contracts";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../src/db/client";
import { inboxItems } from "../src/db/schema";
import { EventStore } from "../src/events/store";
import { SessionRepo } from "../src/services/sessions/repo";
import { sampleSession } from "./helpers";

let dir: string;
let database: Database;
let store: EventStore;
let repo: SessionRepo;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeden-orphans-"));
  database = openDatabase(join(dir, "codeden.db"));
  store = new EventStore(database.db);
  repo = new SessionRepo(database.db, store);
  store.append([{ type: "session.created", sessionId: "s1", payload: { session: sampleSession } }]);
});

afterEach(() => {
  database.close();
  rmSync(dir, { recursive: true, force: true });
});

const agent = (...events: AgentEvent[]) =>
  store.append(events.map((e) => agentEventToNewEvent("s1", e)));

const approval = (id: string): Item => ({
  id,
  kind: "approval_request",
  status: "in_progress",
  requestId: `req-${id}`,
  action: "command",
  title: "Run a command",
  options: ["allow_once", "deny"],
});

const openInbox = () =>
  database.db
    .select()
    .from(inboxItems)
    .where(eq(inboxItems.status, "open"))
    .all()
    .map((r) => r.id);

describe("closing turns a dead runner left open", () => {
  it("ends running turns and cancels their approvals, but keeps deferred ask_user questions", () => {
    agent(
      { type: "thread.started", thread: { id: "root" } },
      { type: "turn.started", threadId: "root", turnId: "u1" },
      { type: "item.started", threadId: "root", turnId: "u1", item: approval("a1") },
      {
        type: "thread.started",
        thread: { id: "child", parentThreadId: "root", parentItemId: "task-1" },
      },
      { type: "turn.started", threadId: "child", turnId: "c1" },
      { type: "item.started", threadId: "child", turnId: "c1", item: approval("a2") },
      {
        type: "item.started",
        threadId: "root",
        turnId: "u1",
        item: {
          id: "q1",
          kind: "user_question",
          status: "in_progress",
          requestId: "ask-1",
          deferred: true,
          questions: [
            {
              id: "q",
              question: "Which one?",
              options: [],
              multiSelect: false,
              allowFreeText: true,
            },
          ],
        },
      },
    );
    expect(repo.get("s1").status).toBe("waiting");
    expect(openInbox()).toHaveLength(3);

    expect(repo.closeOrphanedTurns("s1")).toBe(2);

    expect(repo.item("s1", "a1")?.item.status).toBe("cancelled");
    expect(repo.item("s1", "a2")?.item.status).toBe("cancelled");
    expect(repo.item("s1", "q1")?.item.status).toBe("in_progress");
    expect(openInbox()).toEqual(["inbox:s1:q1"]);
    // Cut off by a restart: recovery resumes it.
    expect(repo.get("s1").status).toBe("interrupted");
    // Nothing left to close.
    expect(repo.closeOrphanedTurns("s1")).toBe(0);
  });

  it("cancels a provider request whose turn already ended", () => {
    agent(
      { type: "thread.started", thread: { id: "root" } },
      { type: "turn.started", threadId: "root", turnId: "u1" },
      { type: "turn.completed", threadId: "root", turnId: "u1" },
    );
    // A request that arrived after its turn ended (the ordering a crash can leave behind).
    agent({ type: "item.started", threadId: "root", turnId: "u1", item: approval("late") });
    expect(repo.get("s1").status).toBe("waiting");

    expect(repo.closeOrphanedTurns("s1")).toBe(1);
    expect(repo.item("s1", "late")?.item.status).toBe("cancelled");
    expect(repo.get("s1").status).toBe("idle");
    expect(openInbox()).toEqual([]);
  });
});
