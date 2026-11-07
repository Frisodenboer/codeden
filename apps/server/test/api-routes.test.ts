import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FsListResponse,
  InboxCounts,
  SecretsStatus,
  SessionDetail,
  SetupStatus,
  StartSessionResponse,
} from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RunningServer, startServer } from "../src";
import type { Exec } from "../src/services/exec";

const TOKEN = "a".repeat(64);
let home: string;
let server: RunningServer;

const fakeExec: Exec = async (command, args) => {
  const key = [command, ...args].join(" ");
  const ok = (stdout: string) => ({
    code: 0,
    stdout,
    stderr: "",
    notFound: false,
    timedOut: false,
    path: command,
  });
  if (key === "codex --version") return ok("codex-cli 0.1.0");
  if (key === "codex login status") return ok("Logged in using ChatGPT");
  return { code: null, stdout: "", stderr: "", notFound: true, timedOut: false, path: null };
};

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "codeden-routes-"));
  mkdirSync(join(home, "user", "work", "app"), { recursive: true });
  server = await startServer({
    port: 0,
    dataDir: join(home, "data"),
    token: TOKEN,
    runner: false,
    secrets: "memory",
    checkSetupOnStart: false,
    exec: fakeExec,
    userHome: join(home, "user"),
  });
});

afterEach(async () => {
  await server.close();
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${server.url}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return {
    status: res.status,
    headers: res.headers,
    text,
    json: () => JSON.parse(text) as unknown,
  };
};

describe("api routes", () => {
  it("validates bodies and maps service errors", async () => {
    const bad = await call("POST", "/sessions", { projectId: 5 });
    expect(bad.status).toBe(400);
    expect(bad.json()).toMatchObject({ error: { code: "bad_request" } });
    const missing = await call("POST", "/sessions", { projectId: "nope", input: { text: "x" } });
    expect(missing.status).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: "project_not_found" } });
    expect((await call("GET", "/sessions/nope")).status).toBe(404);
  });

  it("fails a start cleanly when no runner is available and raises an inbox item", async () => {
    const folder = join(home, "user", "work", "app");
    const project = (
      await call("POST", "/projects", { source: { type: "local", path: folder } })
    ).json() as {
      project: { id: string };
    };
    const start = StartSessionResponse.parse(
      (
        await call("POST", "/sessions", { projectId: project.project.id, input: { text: "hi" } })
      ).json(),
    );
    if (start.status !== "started") throw new Error("expected started");
    await server.services.sessions.launching.get(start.sessionId);
    const detail = SessionDetail.parse((await call("GET", `/sessions/${start.sessionId}`)).json());
    expect(detail.session.status).toBe("failed");
    expect(detail.session.provider).toBe("claude");
    const counts = InboxCounts.parse((await call("GET", "/inbox/counts")).json());
    expect(counts).toMatchObject({ open: 1, byKind: { run_failed: 1 } });
    const [item] = (await call("GET", "/inbox")).json() as Array<{ id: string }>;
    const dismissed = await call("POST", `/inbox/${item?.id}/resolve`, { status: "dismissed" });
    expect(dismissed.json()).toMatchObject({ status: "dismissed" });
    expect(InboxCounts.parse((await call("GET", "/inbox/counts")).json()).open).toBe(0);
  });

  it("serves first-run setup status, login commands and completion", async () => {
    const status = SetupStatus.parse((await call("GET", "/setup/status")).json());
    expect(status.ready).toBe(true);
    expect(status.checks.find((c) => c.id === "codex")).toMatchObject({
      state: "ok",
      loggedIn: true,
    });
    expect(status.checks.find((c) => c.id === "claude")?.fix?.kind).toBe("install");
    expect((await call("POST", "/setup/login/codex")).json()).toMatchObject({
      command: "codex login",
    });
    expect((await call("POST", "/setup/login/rm")).status).toBe(400);
    await call("POST", "/setup/complete");
    expect(SetupStatus.parse((await call("GET", "/setup/status")).json()).setupCompleted).toBe(
      true,
    );
    const settings = (await call("GET", "/settings")).json() as { setup: { completed: boolean } };
    expect(settings.setup.completed).toBe(true);
  });

  it("lists folders for the picker starting at home", async () => {
    const listing = FsListResponse.parse((await call("GET", "/fs/list")).json());
    expect(listing.path).toBe(join(home, "user"));
    expect(listing.entries.map((e) => e.name)).toEqual(["work"]);
    const inner = FsListResponse.parse(
      (await call("GET", `/fs/list?path=${encodeURIComponent(join(home, "user", "work"))}`)).json(),
    );
    expect(inner.entries.map((e) => e.name)).toEqual(["app"]);
  });

  it("reads and writes provider config files through the guard", async () => {
    const put = await call("PUT", "/files", { root: "claude", path: "CLAUDE.md", content: "# Me" });
    expect(put.json()).toMatchObject({ exists: true, content: "# Me" });
    const read = await call("GET", "/files?root=claude&path=CLAUDE.md");
    expect(read.json()).toMatchObject({ content: "# Me" });
    expect((await call("GET", "/files?root=claude&path=../escape.txt")).status).toBe(403);
    expect((await call("GET", "/files?root=claude&path=.credentials.json")).status).toBe(403);
  });

  it("serves artifacts with safe headers", async () => {
    const artifact = server.services.artifacts.save({
      bytes: Buffer.from("<svg onload=alert(1)>"),
      name: 'evil".svg',
      mediaType: "image/svg+xml",
      kind: "file",
    });
    const res = await call("GET", `/artifacts/${artifact.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.text).toBe("<svg onload=alert(1)>");
    expect((await call("GET", "/artifacts/missing")).status).toBe(404);
  });

  it("stores secrets without ever returning them", async () => {
    expect((await call("PUT", "/secrets/elevenlabs.apiKey", { value: "sk-secret" })).status).toBe(
      200,
    );
    const status = await call("GET", "/secrets");
    expect(status.text).not.toContain("sk-secret");
    const parsed = SecretsStatus.parse(status.json());
    expect(parsed.backend).toBe("memory");
    expect(parsed.keys.find((k) => k.key === "elevenlabs.apiKey")?.set).toBe(true);
    expect((await call("PUT", "/secrets/github.token", { value: "x" })).status).toBe(400);
    await call("DELETE", "/secrets/elevenlabs.apiKey");
    expect(
      SecretsStatus.parse((await call("GET", "/secrets")).json()).keys.every((k) => !k.set),
    ).toBe(true);
  });
});
