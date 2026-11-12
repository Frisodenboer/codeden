import { defaultSettings, type Session, type Settings } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { AutoArchive, archiveDue } from "../src/services/sessions/auto-archive";
import type { SessionRepo } from "../src/services/sessions/repo";
import { sampleSession } from "./helpers";

const NOW = Date.parse("2026-11-12T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;

const finished = (over: Partial<Session> = {}, outcome = "success" as const): Session => ({
  ...sampleSession,
  id: "s1",
  role: "agent",
  projectId: "p1",
  status: "idle",
  updatedAt: ago(15 * MIN),
  result: { outcome, summary: "Done", at: ago(15 * MIN) },
  ...over,
});

describe("archiveDue", () => {
  const due = (s: Session, queued = false) => archiveDue(s, NOW, { queued });

  it("archives a successful agent 10 minutes after it finished", () => {
    expect(due(finished())).toBe(true);
    expect(due(finished({ updatedAt: ago(5 * MIN) }))).toBe(false);
  });

  it("waits a day for partial, blocked or failed results", () => {
    const partial = (at: number): Session => ({
      ...finished({ updatedAt: ago(at) }),
      result: { outcome: "partial", summary: "Half", at: ago(at) },
    });
    expect(due(partial(15 * MIN))).toBe(false);
    expect(due(partial(25 * 60 * MIN))).toBe(true);
  });

  it("keeps sessions that are not done or still needed", () => {
    expect(due(finished({ result: null }))).toBe(false);
    expect(due(finished({ status: "running" }))).toBe(false);
    expect(due(finished({ status: "waiting" }))).toBe(false);
    expect(due(finished({ role: "pm" }))).toBe(false);
    expect(due(finished({ archivedAt: ago(MIN) }))).toBe(false);
    expect(due(finished(), true)).toBe(false);
    const pr = { number: 1, url: "https://github.com/o/r/pull/1", state: "open" as const };
    expect(due(finished({ pr } as Partial<Session>))).toBe(false);
    expect(due(finished({ pr: { ...pr, state: "merged" } } as Partial<Session>))).toBe(true);
  });
});

describe("AutoArchive", () => {
  const setup = (sessions: Session[], worktree: "removed" | "kept_changes" = "removed") => {
    let settings: Settings = defaultSettings();
    const store = new Map(sessions.map((s) => [s.id, s]));
    const calls: string[] = [];
    const repo = {
      list: () => [...store.values()],
    } as unknown as SessionRepo;
    const service = new AutoArchive({
      repo,
      settings: () => settings,
      now: () => NOW,
      hasQueued: () => false,
      archive: async (id) => {
        calls.push(`archive ${id}`);
        const s = { ...(store.get(id) as Session), archivedAt: ago(0), status: "stopped" as const };
        store.set(id, s);
        return { session: s, worktree: { status: worktree, message: null } };
      },
      unarchive: (id) => {
        calls.push(`unarchive ${id}`);
        const s = { ...(store.get(id) as Session), archivedAt: null, updatedAt: ago(0) };
        store.set(id, s);
        return s;
      },
    });
    return {
      service,
      calls,
      off: () => {
        settings = { ...settings, sessions: { ...settings.sessions, autoArchive: false } };
      },
    };
  };

  it("archives finished sessions and leaves the rest", async () => {
    const { service, calls } = setup([finished(), finished({ id: "s2", result: null })]);
    expect(await service.sweep()).toEqual(["s1"]);
    expect(calls).toEqual(["archive s1"]);
  });

  it("shows a session again when its worktree has uncommitted changes, and leaves it be", async () => {
    const { service, calls } = setup([finished()], "kept_changes");
    expect(await service.sweep()).toEqual([]);
    expect(calls).toEqual(["archive s1", "unarchive s1"]);
  });

  it("does nothing when switched off", async () => {
    const { service, calls, off } = setup([finished()]);
    off();
    expect(await service.sweep()).toEqual([]);
    expect(calls).toEqual([]);
  });
});
