import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ArchiveSessionResponse, defaultSettings, type Session } from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sessionWorkdir } from "../src/services/sessions/workdir";
import { cleanupDue } from "../src/services/sessions/worktree-cleanup";
import { sampleSession } from "./helpers";
import { type Harness, startHarness, waitUntil } from "./support/harness";

const DAY = 24 * 60 * 60 * 1000;
let clock = Date.now();
let h: Harness;

beforeAll(async () => {
  h = await startHarness({
    worktreeCleanup: { now: () => new Date(clock), initialDelayMs: 60 * 60_000 },
  });
}, 60_000);

afterAll(async () => {
  await h?.close();
});

const archive = async (id: string, body: unknown = {}) => {
  const res = await h.api("POST", `/sessions/${id}/archive`, body);
  expect(res.status).toBe(200);
  return ArchiveSessionResponse.parse(res.body);
};
const branches = () =>
  execFileSync("git", ["-C", h.repo, "branch", "--list", "codeden/*"], { encoding: "utf8" });
const services = () => h.server.services;

describe("worktree cleanup (§9)", () => {
  it("archives a session: removes the worktree, keeps the branch, restores it on the next message", async () => {
    const id = await h.startFakeSession();
    const before = (await h.detail(id)).session;
    const worktree = before.worktreePath as string;
    expect(existsSync(worktree)).toBe(true);

    const archived = await archive(id);
    expect(archived.worktree.status).toBe("removed");
    expect(archived.session.archivedAt).toBeTruthy();
    expect(archived.session.worktreeRemovedAt).toBeTruthy();
    expect(existsSync(worktree)).toBe(false);
    expect(branches()).toContain(before.branch as string);

    // Files and terminals explain what happened instead of failing on a missing folder.
    const files = await h.api("GET", `/sessions/${id}/files`);
    expect(files.status).toBe(409);
    expect(JSON.stringify(files.body)).toContain("worktree_removed");

    const sent = await h.api("POST", `/sessions/${id}/messages`, { input: { text: "again" } });
    expect(sent.status).toBe(200);
    const after = await waitUntil(async () => {
      const s = (await h.detail(id)).session;
      return s.status === "idle" && !s.worktreeRemovedAt ? s : undefined;
    });
    expect(after.archivedAt).toBeNull();
    expect(after.worktreePath).toBe(worktree);
    expect(existsSync(worktree)).toBe(true);
  }, 60_000);

  it("keeps a worktree with uncommitted changes unless forced", async () => {
    const id = await h.startFakeSession();
    const worktree = (await h.detail(id)).session.worktreePath as string;
    writeFileSync(join(worktree, "notes.txt"), "not committed\n");

    const kept = await archive(id);
    expect(kept.worktree.status).toBe("kept_changes");
    expect(kept.session.archivedAt).toBeTruthy();
    expect(kept.session.worktreeRemovedAt).toBeFalsy();
    expect(existsSync(join(worktree, "notes.txt"))).toBe(true);

    const forced = await archive(id, { force: true });
    expect(forced.worktree.status).toBe("removed");
    expect(existsSync(worktree)).toBe(false);
  }, 60_000);

  it("sweeps worktrees inactive for the configured days, unless the PR is open", async () => {
    const idle = await h.startFakeSession();
    const reviewed = await h.startFakeSession();
    services().sessionRepo.update(reviewed, (s) => ({
      ...s,
      pr: { number: 7, url: "https://github.com/acme/app/pull/7", state: "open" },
    }));
    const idleTree = (await h.detail(idle)).session.worktreePath as string;
    const reviewedTree = (await h.detail(reviewed)).session.worktreePath as string;

    clock = Date.now();
    expect(await services().worktreeCleanup.sweep()).toEqual([]);

    clock = Date.now() + 8 * DAY;
    const removed = await services().worktreeCleanup.sweep();
    expect(removed).toContain(idle);
    expect(removed).not.toContain(reviewed);
    expect(existsSync(idleTree)).toBe(false);
    expect(existsSync(reviewedTree)).toBe(true);
    expect((await h.detail(idle)).session.worktreeRemovedAt).toBeTruthy();
  }, 60_000);

  it("leaves inactive worktrees alone when cleanup is off", async () => {
    const id = await h.startFakeSession();
    const res = await h.api("PATCH", "/settings", { worktrees: { cleanup: false } });
    expect(res.status).toBe(200);
    clock = Date.now() + 30 * DAY;
    expect(await services().worktreeCleanup.sweep()).not.toContain(id);
    expect(existsSync((await h.detail(id)).session.worktreePath as string)).toBe(true);
    await h.api("PATCH", "/settings", { worktrees: { cleanup: true } });
  }, 60_000);

  it("cleans up a project's worktrees when the project is archived", async () => {
    const id = await h.startFakeSession();
    const worktree = (await h.detail(id)).session.worktreePath as string;
    clock = Date.now();
    expect((await h.api("DELETE", `/projects/${h.projectId}`)).status).toBe(200);
    await waitUntil(async () =>
      (await h.detail(id)).session.worktreeRemovedAt ? true : undefined,
    );
    expect(existsSync(worktree)).toBe(false);
  }, 60_000);
});

describe("cleanupDue", () => {
  const settings = defaultSettings().worktrees;
  const now = new Date("2026-11-20T00:00:00.000Z");
  const old = "2026-11-01T00:00:00.000Z";
  const base: Session = {
    ...sampleSession,
    role: "agent",
    projectId: "p1",
    status: "idle",
    worktreePath: "/home/me/.codeden/wt/app/s1",
    updatedAt: old,
  };

  it("removes inactive worktrees and keeps busy, recent or reviewed ones", () => {
    expect(cleanupDue(base, now, settings)).toBe(true);
    expect(cleanupDue({ ...base, updatedAt: "2026-11-18T00:00:00.000Z" }, now, settings)).toBe(
      false,
    );
    for (const status of ["running", "waiting", "starting", "queued"] as const) {
      expect(cleanupDue({ ...base, status }, now, settings)).toBe(false);
    }
    const pr = { number: 1, url: "https://github.com/acme/app/pull/1" };
    expect(cleanupDue({ ...base, pr: { ...pr, state: "draft" } }, now, settings)).toBe(false);
    expect(cleanupDue({ ...base, pr: { ...pr, state: "merged" } }, now, settings)).toBe(true);
    expect(cleanupDue({ ...base, worktreeRemovedAt: old }, now, settings)).toBe(false);
    expect(cleanupDue({ ...base, worktreePath: null }, now, settings)).toBe(false);
    expect(cleanupDue({ ...base, role: "pm" }, now, settings)).toBe(false);
  });

  it("retries archived sessions even with cleanup off", () => {
    const off = { ...settings, cleanup: false };
    expect(cleanupDue(base, now, off)).toBe(false);
    const archived = { ...base, archivedAt: old, updatedAt: now.toISOString() };
    expect(cleanupDue(archived, now, off)).toBe(true);
  });

  it("refuses the workdir of a removed worktree", () => {
    expect(sessionWorkdir(base)).toBe(base.worktreePath);
    expect(() => sessionWorkdir({ ...base, worktreeRemovedAt: old })).toThrow(/cleaned up/);
  });
});
