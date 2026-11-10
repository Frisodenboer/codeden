import { defaultSettings, type Settings, type UserInput } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PR_FEEDBACK_MAX_ROUNDS,
  PrFeedbackService,
  receivesPrFeedback,
} from "../src/services/sessions/pr-feedback";
import { sampleSession } from "./helpers";
import { createGithubEnv, type GithubEnv } from "./support/github-env";

let env: GithubEnv;
let service: PrFeedbackService;
let settings: Settings;
let sent: Array<{ sessionId: string; input: UserInput }>;
const P = "p-gh";

beforeEach(() => {
  env = createGithubEnv();
  settings = defaultSettings();
  sent = [];
  service = new PrFeedbackService({
    store: env.store,
    repo: env.repo,
    settings: () => settings,
    send: async (sessionId, input) => {
      sent.push({ sessionId, input });
    },
  });
  service.start();
});

afterEach(() => {
  service.stop();
  env.close();
});

const sync = async () => {
  await env.service.syncNow(P);
  await service.idle();
};

/** A session the user started with an open PR on its branch, already synced. */
async function userSessionWithPr(patch: Parameters<GithubEnv["addSession"]>[0] = {}) {
  const session = env.addSession({ branch: "codeden/task-1", ...patch });
  env.gh.addPr("codeden/task-1");
  await sync();
  return session;
}

const failChecks = (sha: string) =>
  env.gh.touch(1, (i) => {
    if (!i.pr) return;
    i.pr.headSha = sha;
    i.pr.checks = [
      { name: "test", status: "COMPLETED", conclusion: "FAILURE" },
      { name: "lint", status: "COMPLETED", conclusion: "SUCCESS" },
    ];
  });

describe("PR feedback for sessions the user started", () => {
  it("tells the agent which checks failed, once per head commit", async () => {
    const session = await userSessionWithPr();
    failChecks("sha-2");
    await sync();
    expect(sent).toHaveLength(1);
    expect(sent[0]?.sessionId).toBe(session.id);
    expect(sent[0]?.input.from).toBe("codeden");
    expect(sent[0]?.input.text).toContain("CI failed on your pull request #1 (commit sha-2)");
    expect(sent[0]?.input.text).toContain("- test (failure): https://ci/test");
    expect(sent[0]?.input.text).not.toContain("lint");
    expect(sent[0]?.input.text).toContain("gh run view <run-id> --log-failed");

    // Another sync of the same head says nothing new.
    env.gh.touch(1, () => undefined);
    await sync();
    expect(sent).toHaveLength(1);
  });

  it("passes on requested changes and merge conflicts", async () => {
    await userSessionWithPr();
    env.gh.touch(1, (i) => {
      if (!i.pr) return;
      i.pr.reviews = [
        {
          id: "r1",
          author: "lee",
          state: "CHANGES_REQUESTED",
          body: "Please add a test for the empty case.",
          submittedAt: "2026-11-01T01:00:00Z",
        },
      ];
    });
    await sync();
    env.gh.touch(1, (i) => {
      if (i.pr) i.pr.mergeable = "CONFLICTING";
    });
    await sync();
    expect(sent.map((s) => s.input.text.split("\n")[0])).toEqual([
      "@lee requested changes on your pull request #1.",
      "Your pull request #1 has merge conflicts with `main`. Fetch, merge `origin/main` into your branch, resolve the conflicts, run the checks, and push.",
    ]);
    expect(sent[0]?.input.text).toContain("Please add a test for the empty case.");
    expect(sent[0]?.input.text).toContain("gh pr view 1 --comments");
  });

  it(`stops after ${PR_FEEDBACK_MAX_ROUNDS} rounds per PR`, async () => {
    await userSessionWithPr();
    for (let n = 2; n < 2 + PR_FEEDBACK_MAX_ROUNDS + 2; n++) {
      env.gh.touch(1, (i) => {
        if (i.pr) i.pr.checks = [];
      });
      await sync();
      failChecks(`sha-${n}`);
      await sync();
    }
    expect(sent).toHaveLength(PR_FEEDBACK_MAX_ROUNDS);
  });

  it("leaves PM, orchestrator and automation work to the PM, and respects the switch", async () => {
    await userSessionWithPr({ startedBy: { kind: "pm" } });
    failChecks("sha-2");
    await sync();
    expect(sent).toHaveLength(0);

    env.close();
    env = createGithubEnv();
    service.stop();
    service = new PrFeedbackService({
      store: env.store,
      repo: env.repo,
      settings: () => settings,
      send: async (sessionId, input) => {
        sent.push({ sessionId, input });
      },
    });
    service.start();
    settings = { ...settings, sessions: { ...settings.sessions, prFeedback: false } };
    await userSessionWithPr();
    failChecks("sha-2");
    await sync();
    expect(sent).toHaveLength(0);
  });

  it("only goes to an open agent session", () => {
    const user = {
      ...sampleSession,
      startedBy: { kind: "user" as const },
      status: "idle" as const,
    };
    expect(receivesPrFeedback(user)).toBe(true);
    expect(receivesPrFeedback({ ...user, status: "running" })).toBe(true);
    expect(receivesPrFeedback({ ...user, status: "stopped" })).toBe(false);
    expect(receivesPrFeedback({ ...user, archivedAt: "2026-11-01T00:00:00.000Z" })).toBe(false);
    expect(receivesPrFeedback({ ...user, parentSessionId: "pm-1" })).toBe(false);
    expect(receivesPrFeedback({ ...user, startedBy: { kind: "automation", id: "a1" } })).toBe(
      false,
    );
    expect(receivesPrFeedback({ ...user, role: "pm" })).toBe(false);
  });
});
