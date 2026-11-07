import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prReviewInboxId } from "../src/services/github/review-inbox";
import { InboxService } from "../src/services/inbox-service";
import { deriveGithubNotices } from "../src/services/orchestration/github-notices";
import { GithubServicePort } from "../src/services/orchestration/github-port";
import { createGithubEnv, type GithubEnv } from "./support/github-env";

let env: GithubEnv;
const P = "p-gh";
const waitTick = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  env = createGithubEnv();
});
afterEach(() => env.close());

const session = (id: string) => env.repo.find(id)?.session;

describe("GitHub notices for the PM (§8.2)", () => {
  it("turns GitHub sync events into typed notices that wake the PM", async () => {
    const owned = env.addSession({ branch: "codeden/task-1", startedBy: { kind: "pm" } });
    env.gh.addPr("codeden/task-1");
    env.gh.addPr("feature/human");
    await env.service.syncNow(P);

    env.gh.addIssue({ title: "Crash on save", labels: ["bug"] });
    env.gh.touch(1, (i) => {
      if (i.pr) i.pr.checks = [{ name: "ci", status: "COMPLETED", conclusion: "FAILURE" }];
    });
    env.gh.touch(2, (i) => {
      if (!i.pr) return;
      i.pr.checks = [{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }];
      i.pr.reviews = [
        {
          id: "r1",
          author: "lee",
          state: "APPROVED",
          body: "LGTM",
          submittedAt: "2026-11-01T01:00:00Z",
        },
      ];
    });
    const mark = env.events.length;
    await env.service.syncNow(P);
    const derived = deriveGithubNotices(env.events.slice(mark), session);
    const byType = Object.fromEntries(derived.map((d) => [d.notice.type, d]));

    expect(byType["issue.opened"]).toMatchObject({
      wake: true,
      notice: { target: "pm", projectId: P, data: { labels: ["bug"], issue: { number: 3 } } },
    });
    // The session's PR wakes the PM; the human PR's check result waits for the digest.
    expect(byType["pr.checks_failed"]).toMatchObject({
      wake: true,
      notice: { sessionId: owned.id, data: { failedChecks: ["ci"], pr: { number: 1 } } },
    });
    expect(byType["pr.checks_passed"]).toMatchObject({ wake: false, notice: { sessionId: null } });
    expect(byType["review.submitted"]).toMatchObject({
      wake: true,
      notice: { data: { reviewer: "lee", state: "approved", body: "LGTM" } },
    });
    // Replaying the same events yields the same ids (no duplicate notices).
    const again = deriveGithubNotices(env.events.slice(mark), session).map((d) => d.notice.id);
    expect(again).toEqual(derived.map((d) => d.notice.id));
  });

  it("notifies on pr.opened and pr.merged with linked issues", async () => {
    env.gh.addIssue({ title: "Bug" });
    await env.service.syncNow(P);
    env.gh.addPr("feature/fix", { body: "Fixes #1" });
    let mark = env.events.length;
    await env.service.syncNow(P);
    const opened = deriveGithubNotices(env.events.slice(mark), session);
    expect(opened.find((d) => d.notice.type === "pr.opened")).toMatchObject({
      wake: true,
      notice: { id: `pr.opened:${P}:2` },
    });

    mark = env.events.length;
    await env.service.mergePr(`${P}:2`, { method: "squash" });
    const merged = deriveGithubNotices(env.events.slice(mark), session);
    expect(merged.find((d) => d.notice.type === "pr.merged")?.notice).toMatchObject({
      data: { linkedIssues: [1], pr: { state: "merged" } },
    });
  });
});

describe("pr_review inbox items", () => {
  it("raises one item when a session's PR is ready for review and resolves it on merge", async () => {
    const owner = env.addSession({ branch: "codeden/ready" });
    env.service.start({ sync: false });
    await env.service.syncNow(P);
    env.gh.addPr("codeden/ready", {}, { draft: true });
    await env.service.syncNow(P);
    await waitTick();
    const inbox = new InboxService(env.db.db, env.store, () => async () => {});
    const id = prReviewInboxId(P, 1);
    expect(inbox.find(id)).toBeUndefined();

    env.gh.touch(1, (i) => {
      if (!i.pr) return;
      i.pr.draft = false;
      i.pr.checks = [{ name: "ci", status: "COMPLETED", conclusion: "SUCCESS" }];
    });
    await env.service.syncNow(P);
    await waitTick();
    expect(inbox.find(id)).toMatchObject({
      kind: "pr_review",
      status: "open",
      sessionId: owner.id,
      pr: { number: 1, state: "open" },
    });

    await env.service.mergePr(`${P}:1`, { method: "squash" });
    await waitTick();
    expect(inbox.find(id)).toMatchObject({ status: "resolved" });
  });
});

describe("GithubServicePort", () => {
  it("backs the PM issue tools with GithubService", async () => {
    env.gh.addIssue({ title: "Bug", labels: ["bug"] });
    await env.service.syncNow(P);
    const port = new GithubServicePort(env.service);
    expect((await port.listIssues(env.githubProject, { labels: ["bug"] }))[0]).toMatchObject({
      number: 1,
      title: "Bug",
    });
    const triaged = await port.triageIssue(env.githubProject, 1, {
      decision: "ready",
      labels: ["ready"],
    });
    expect(triaged).toMatchObject({ decision: "ready", closed: false });
    const created = await port.createIssue(env.githubProject, { title: "Next", body: "" });
    expect(created.title).toBe("Next");
  });
});
