import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentEvent, SessionOptions } from "@codeden/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildQueryOptions } from "../src/claude/options";
import { CodexSession } from "../src/codex/session";
import { explicitModel } from "../src/util/model";

const base: SessionOptions = {
  sessionId: "s1",
  role: "agent",
  cwd: tmpdir(),
  autonomy: "auto",
  mcpServers: [],
  additionalDirectories: [],
  planMode: false,
};

const fakeCodex = {
  kind: "node-script" as const,
  path: process.execPath,
  script: join(import.meta.dirname, "fixtures", "fake-codex", "app-server.mjs"),
};

function claudeOptions(model: string | undefined) {
  return buildQueryOptions({
    session: { ...base, model },
    executable: { kind: "native", path: "/bin/claude" } as never,
    canUseTool: async () => ({ behavior: "allow", updatedInput: {} }),
    hooks: {},
    abortController: new AbortController(),
  });
}

/** Codex requests recorded by the fake app-server. */
function requests(file: string): Array<{ method: string; params: Record<string, unknown> }> {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}

/** One consumer for the session's events (iterating twice would close the queue). */
function turnCounter(session: CodexSession) {
  let completed = 0;
  void (async () => {
    for await (const event of session.events as AsyncIterable<AgentEvent>) {
      if (event.type === "turn.completed") completed++;
    }
  })();
  return async (count: number) => {
    const deadline = Date.now() + 5000;
    while (completed < count) {
      if (Date.now() > deadline) throw new Error(`turn ${count} did not complete`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
}

const sessions: CodexSession[] = [];
afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
  delete process.env.FAKE_CODEX_LOG;
});

describe("the Default model", () => {
  it("is never sent as a model id", () => {
    expect(explicitModel("default")).toBeUndefined();
    expect(explicitModel(" ")).toBeUndefined();
    expect(explicitModel(null)).toBeUndefined();
    expect(explicitModel(undefined)).toBeUndefined();
    expect(explicitModel("gpt-5.5")).toBe("gpt-5.5");
  });

  it("leaves the model out for Claude so the CLI uses its own default", () => {
    expect(claudeOptions("default")).not.toHaveProperty("model");
    expect(claudeOptions(undefined)).not.toHaveProperty("model");
    expect(claudeOptions("opus")).toMatchObject({ model: "opus" });
  });

  it("leaves the model out of Codex thread/start, and resolves it when switching back", async () => {
    const log = join(mkdtempSync(join(tmpdir(), "codeden-codex-model-")), "requests.log");
    process.env.FAKE_CODEX_LOG = log;
    const session = new CodexSession({ ...base, model: "default" }, { executable: fakeCodex });
    sessions.push(session);
    await session.start();
    const start = requests(log).find((r) => r.method === "thread/start");
    expect(start?.params).not.toHaveProperty("model");

    const completed = turnCounter(session);
    let sent = 0;
    const send = async (text: string) => {
      await session.send({ text, attachments: [] });
      await completed(++sent);
    };
    await send("first");
    await session.configure({ model: "gpt-other" });
    await send("second");
    await session.configure({ model: "default" });
    await send("third");

    const turns = requests(log).filter((r) => r.method === "turn/start");
    expect(turns.map((t) => t.params.model)).toEqual([undefined, "gpt-other", "gpt-configured"]);
  });
});
