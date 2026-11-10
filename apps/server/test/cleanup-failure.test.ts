import { defaultSettings, type RunnerCommandName, type RunnerCommandOf } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RunnerCommandError } from "../src/runner/client";
import type { ProjectService } from "../src/services/projects/project-service";
import type { RunnerPort } from "../src/services/runner-port";
import { cleanupInboxId, WorktreeCleanup } from "../src/services/sessions/worktree-cleanup";
import { createGithubEnv, type GithubEnv } from "./support/github-env";

let env: GithubEnv;
let cleanup: WorktreeCleanup;
/** What `workspace.remove` does next: throw this error, or succeed. */
let failWith: Error | null;

const IN_USE = new RunnerCommandError(
  "worktree_in_use",
  "A file in the worktree is in use (node_modules). Close whatever is using it (a terminal, dev server or editor), then try again.",
);

beforeEach(() => {
  env = createGithubEnv();
  failWith = IN_USE;
  const runner = {
    isConnected: () => true,
    runnerId: () => "r1",
    providers: () => [],
    mcpProxyUrl: () => null,
    waitForConnection: async () => true,
    request: (async (command: RunnerCommandOf<RunnerCommandName>) => {
      if (command.name === "workspace.remove" && failWith) throw failWith;
      return command.name === "workspace.remove" ? { removed: true } : {};
    }) as RunnerPort["request"],
  } as unknown as RunnerPort;
  cleanup = new WorktreeCleanup({
    repo: env.repo,
    projects: { get: () => env.githubProject } as unknown as ProjectService,
    runner,
    store: env.store,
    settings: () => defaultSettings(),
    stopSession: async () => undefined,
    inbox: env.inbox,
  });
});

afterEach(() => env.close());

const report = (sessionId: string) => env.inbox.find(cleanupInboxId(sessionId));

describe("a worktree removal that keeps failing", () => {
  it("is reported in the inbox once, and resolved when a later attempt removes it", async () => {
    const session = env.addSession({ title: "Fix login" });
    const archived = await cleanup.archive(session.id);
    expect(archived.worktree.status).toBe("failed");
    const item = report(session.id);
    expect(item).toMatchObject({
      kind: "cleanup_failed",
      status: "open",
      title: "Couldn't remove the worktree: Fix login",
      sessionId: session.id,
      projectId: env.githubProject.id,
    });
    expect(item?.body).toContain("A file in the worktree is in use");

    // The hourly retry fails the same way: nothing new.
    const before = env.store.listAfter(0, 100_000).length;
    await cleanup.sweep();
    expect(env.store.listAfter(0, 100_000).length).toBe(before);

    failWith = null;
    expect(await cleanup.sweep()).toEqual([session.id]);
    expect(report(session.id)).toMatchObject({ status: "resolved", resolution: { removed: true } });
  });

  it("stays dismissed once the user dismissed it", async () => {
    const session = env.addSession();
    await cleanup.archive(session.id);
    const item = report(session.id);
    if (!item) throw new Error("no report");
    env.inbox.close(item, "dismissed", null);
    failWith = new RunnerCommandError("remove_failed", "Could not delete x: EIO");
    await cleanup.sweep();
    expect(report(session.id)?.status).toBe("dismissed");
  });

  it("is not raised for a worktree kept because of uncommitted changes", async () => {
    const session = env.addSession();
    failWith = new RunnerCommandError("worktree_dirty", "has uncommitted changes");
    expect((await cleanup.archive(session.id)).worktree.status).toBe("kept_changes");
    expect(report(session.id)).toBeUndefined();
  });
});
