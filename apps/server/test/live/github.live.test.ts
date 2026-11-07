/**
 * Live GitHub flow against a throwaway PRIVATE repository under the logged-in `gh` account.
 * Opt-in on top of CODEDEN_LIVE because it creates a repository:
 *   CODEDEN_LIVE_GITHUB=1 pnpm --filter @codeden/server test:live -- github
 * Creates `codeden-sandbox-<random>`, then: issue -> Fake session in a worktree -> change ->
 * create_pull_request -> attach_evidence (PNG on the evidence branch, rendered in the comment)
 * -> commit statuses polled as checks -> squash merge -> merge follow-up. Deletes the repo at
 * the end (needs the `delete_repo` scope; otherwise the name is printed for manual cleanup).
 * Touches no other repository.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import {
  CreateProjectResponse,
  GithubIssue,
  GithubPrDetails,
  SessionDetail,
  StartSessionResponse,
} from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isProcessAlive, type RunningServer, readLiveRunnerLock, startServer } from "../../src";
import { waitUntil } from "../support/harness";

const LIVE = process.env.CODEDEN_LIVE === "1" && process.env.CODEDEN_LIVE_GITHUB === "1";
const TOKEN = "f".repeat(64);

const gh = (...args: string[]) =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A small valid PNG (solid colour), so the evidence is a real image. */
function png(width: number, height: number, rgb: [number, number, number]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3)]);
  for (let x = 0; x < width; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe.skipIf(!LIVE)("live github", () => {
  // Reuse a leftover sandbox (`CODEDEN_LIVE_GITHUB_REPO=codeden-sandbox-xxxxxx`) or create one.
  const reuse = process.env.CODEDEN_LIVE_GITHUB_REPO;
  if (reuse && !/^codeden-sandbox-[a-z0-9]+$/.test(reuse)) {
    throw new Error("CODEDEN_LIVE_GITHUB_REPO must name a codeden-sandbox-* repository");
  }
  const name = reuse ?? `codeden-sandbox-${randomBytes(3).toString("hex")}`;
  let owner = "";
  let home = "";
  let server: RunningServer;
  let created = false;

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${server.url}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  beforeAll(async () => {
    owner = gh("api", "user", "--jq", ".login");
    if (!reuse) {
      gh(
        "repo",
        "create",
        `${owner}/${name}`,
        "--private",
        "--add-readme",
        "--description",
        "CodeDen live test sandbox (safe to delete)",
      );
      console.log(`[live] created private repo ${owner}/${name}`);
    } else {
      expect(
        gh("repo", "view", `${owner}/${name}`, "--json", "visibility", "--jq", ".visibility"),
      ).toBe("PRIVATE");
    }
    created = true;
    home = mkdtempSync(join(tmpdir(), "codeden-ghlive-"));
    const repo = join(home, "repo");
    for (let i = 0; ; i++) {
      try {
        gh("repo", "clone", `${owner}/${name}`, repo);
        break;
      } catch (error) {
        if (i >= 5) throw error;
        await new Promise((r) => setTimeout(r, 2_000));
      }
    }
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
    git("config", "user.email", "codeden-live@example.com");
    git("config", "user.name", "CodeDen Live");
    // Push with the gh login, for this throwaway clone only.
    git("config", "--local", "--add", "credential.helper", "");
    git("config", "--local", "--add", "credential.helper", "!gh auth git-credential");

    server = await startServer({
      port: 0,
      dataDir: join(home, "data"),
      token: TOKEN,
      enableFakeProvider: true,
      waitForRunner: true,
      secrets: "memory",
      checkSetupOnStart: false,
      userHome: home,
      github: { sync: false },
      log: (m) => console.log(`[server] ${m}`),
    });
    await waitUntil(() => server.runner?.mcpProxyUrl ?? undefined);
  }, 180_000);

  afterAll(async () => {
    if (server) {
      const lock = readLiveRunnerLock(server.paths.runnerLock);
      await server.close({ stopRunner: true });
      const deadline = Date.now() + 10_000;
      while (lock && isProcessAlive(lock.pid) && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (created) {
      try {
        gh("repo", "delete", `${owner}/${name}`, "--yes");
        console.log(`[live] deleted ${owner}/${name}`);
      } catch (error) {
        console.log(
          `[live] could not delete ${owner}/${name} (needs the delete_repo scope): ${String(error).split("\n")[0]}`,
        );
      }
    }
    if (home) rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }, 60_000);

  it("issue -> PR -> evidence -> checks -> merge -> follow-up", async () => {
    const project = CreateProjectResponse.parse(
      (await api("POST", "/projects", { source: { type: "local", path: join(home, "repo") } }))
        .body,
    ).project;
    expect(project.kind).toBe("github");
    const projectId = project.id;
    const connection = (await api("GET", "/github/connection")).body;
    expect(connection).toMatchObject({ connected: true, source: "gh", login: owner });
    expect((await api("POST", `/projects/${projectId}/github/sync`)).status).toBe(200);

    // 1. An issue.
    const issue = GithubIssue.parse(
      (
        await api("POST", `/projects/${projectId}/github/issues`, {
          title: "Add a greeting file",
          body: "Live test",
        })
      ).body,
    );

    // 2. A Fake session in its own worktree, linked to the issue.
    const started = StartSessionResponse.parse(
      (
        await api("POST", "/sessions", {
          projectId,
          provider: "fake",
          purpose: "Live GitHub flow",
          workspace: { mode: "worktree" },
          issue: { number: issue.number, url: issue.url, title: issue.title },
          input: { text: "hello" },
        })
      ).body,
    );
    if (started.status !== "started") throw new Error(`not started: ${started.status}`);
    const sessionId = started.sessionId;
    const detail = async () =>
      SessionDetail.parse((await api("GET", `/sessions/${sessionId}`)).body);
    await waitUntil(
      async () => ((await detail()).session.status === "idle" ? true : undefined),
      60_000,
    );
    const session = (await detail()).session;
    expect(session.worktreePath).toBeTruthy();
    // A unique file, so a reused sandbox still gets a diff.
    const file = `greetings/${sessionId}.md`;
    mkdirSync(join(session.worktreePath ?? "", "greetings"), { recursive: true });
    writeFileSync(join(session.worktreePath ?? "", file), "Hello from CodeDen\n");

    const caller = {
      caller: "ui" as const,
      role: "agent" as const,
      sessionId,
      projectId,
      signal: new AbortController().signal,
    };
    // 3. create_pull_request (commits the change, pushes, opens the PR).
    const prResult = await server.services.tools.call(
      "create_pull_request",
      {
        title: "docs: add a greeting",
        body: `Adds ${file}.`,
        commitMessage: "docs: add a greeting",
      },
      caller,
    );
    console.log(`[live] ${prResult.text}`);
    expect(prResult.isError).toBe(false);
    const prNumber = (await detail()).session.pr?.number ?? 0;
    expect(prNumber).toBeGreaterThan(0);
    const prId = encodeURIComponent(`${projectId}:${prNumber}`);
    const details = GithubPrDetails.parse((await api("GET", `/prs/${prId}`)).body);
    expect(details.body).toContain(`Fixes #${issue.number}`);
    expect(details.body).toContain(sessionId);
    expect(details.files.map((f) => f.path)).toEqual([file]);
    expect(details.sessionId).toBe(sessionId);

    // 4. attach_evidence with a real PNG and test output.
    const shot = join(tmpdir(), `codeden-live-${name}.png`);
    writeFileSync(shot, png(320, 180, [38, 132, 255]));
    const evidence = await server.services.tools.call(
      "attach_evidence",
      {
        files: [{ path: shot, name: "screenshot.png", caption: "Greeting page" }],
        summary: "Checked the greeting.",
        testOutput: "1 passed",
      },
      caller,
    );
    console.log(`[live] ${evidence.text}`);
    expect(evidence.isError).toBe(false);
    const imageUrl = /https:\/\/github\.com\/\S+\?raw=true/.exec(evidence.text)?.[0] ?? "";
    expect(imageUrl).toContain(`/${owner}/${name}/blob/`);
    const commentId = /#issuecomment-(\d+)/.exec(evidence.text)?.[1];
    const html = gh(
      "api",
      `repos/${owner}/${name}/issues/comments/${commentId}`,
      "-H",
      "Accept: application/vnd.github.html+json",
      "--jq",
      ".body_html",
    );
    const img = /<img[^>]+src="([^"]+)"/.exec(html)?.[1] ?? "";
    console.log(`[live] rendered <img src>: ${img}`);
    expect(img).not.toBe("");
    expect(img).toBe(imageUrl);
    // github.com serves that URL to signed-in readers (a browser session, not an API token), so
    // check the committed file itself through the API: the exact commit and path, a PNG.
    const [, sha, path] = /\/blob\/([0-9a-f]{40})\/(.+)\?raw=true$/.exec(imageUrl) ?? [];
    const size = gh("api", `repos/${owner}/${name}/contents/${path}?ref=${sha}`, "--jq", ".size");
    expect(Number(size)).toBe(png(320, 180, [38, 132, 255]).length);
    const branch = gh(
      "api",
      `repos/${owner}/${name}/branches/codeden/evidence`,
      "--jq",
      ".commit.sha",
    );
    expect(branch).toBe(sha);

    // 5. Checks: commit statuses on the head commit, picked up by the poller.
    const head = details.headSha ?? "";
    const status = (state: string) =>
      gh(
        "api",
        `repos/${owner}/${name}/statuses/${head}`,
        "-f",
        `state=${state}`,
        "-f",
        "context=codeden/live",
      );
    status("pending");
    await api("POST", `/projects/${projectId}/github/sync`);
    let pr = server.services.github.data.pr(projectId, prNumber);
    expect(pr?.checks.state).toBe("pending");
    status("success");
    await api("POST", `/projects/${projectId}/github/sync`);
    pr = server.services.github.data.pr(projectId, prNumber);
    expect(pr?.checks).toMatchObject({ state: "success", passed: 1 });
    const types = server.store.listAfter(0, 10_000).map((e) => e.type);
    expect(types).toEqual(
      expect.arrayContaining(["issue.opened", "pr.opened", "pr.checks_passed"]),
    );

    // 6. Squash merge, then the follow-up completes the session and comments on the issue.
    const merged = await api("POST", `/prs/${prId}/merge`, {});
    expect(merged.body).toMatchObject({ merged: true });
    await waitUntil(
      async () => ((await detail()).session.status === "completed" ? true : undefined),
      30_000,
    );
    expect((await detail()).session.pr?.state).toBe("merged");
    // GitHub closes the issue (`Fixes #N`) and our link-back comment lands asynchronously.
    await waitUntil(async () => {
      await new Promise((r) => setTimeout(r, 1_500)); // two API calls per probe: go easy
      const after = (await api("GET", `/projects/${projectId}/github/issues/${issue.number}`)).body;
      const comments = ((after.recentComments ?? []) as Array<{ body: string }>).map((c) => c.body);
      const linked = comments.some((c) => c.includes(`Resolved by #${prNumber}`));
      return linked && after.state === "closed" ? true : undefined;
    }, 60_000);
  }, 300_000);
});
