import { Settings } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { type OneShotPort, ProviderUtilityService, plainSpeech } from "../src/services/utility";
import { sampleSession } from "./helpers";

function fakeOneShot(replies: Record<string, string | Error>, available = ["claude", "codex"]) {
  const calls: Array<{ providerId: string; model?: string }> = [];
  const port: OneShotPort = {
    available: () => available,
    oneShot: async (providerId, req) => {
      calls.push({ providerId, model: req.model });
      const reply = replies[providerId];
      if (reply instanceof Error) throw reply;
      if (reply === undefined) throw new Error("no reply");
      return reply;
    },
  };
  return { port, calls };
}

const service = (port: OneShotPort, patch: Record<string, unknown> = {}) =>
  new ProviderUtilityService({ settings: () => Settings.parse(patch), oneShot: port });

describe("ProviderUtilityService", () => {
  it("titles a session from its first message on Claude by default", async () => {
    const { port, calls } = fakeOneShot({ claude: '"Fix login redirect bug".\n' });
    const title = await service(port).sessionTitle({
      session: sampleSession,
      finalMessage: null,
      firstMessage: "The login page redirects in a loop",
    });
    expect(title).toBe("Fix login redirect bug");
    expect(calls).toEqual([{ providerId: "claude", model: undefined }]);
  });

  it("falls back to Codex when Claude fails, and never throws", async () => {
    const { port, calls } = fakeOneShot({
      claude: new Error("rate limited"),
      codex: "- Add tests\n- Update the README\n3. Run the linter",
    });
    const followups = await service(port).suggestFollowups({
      session: sampleSession,
      finalMessage: "I fixed the bug.",
    });
    expect(followups?.map((f) => f.prompt)).toEqual([
      "Add tests",
      "Update the README",
      "Run the linter",
    ]);
    expect(calls.map((c) => c.providerId)).toEqual(["claude", "codex"]);
    const none = await service(fakeOneShot({}).port).suggestFollowups({
      session: sampleSession,
      finalMessage: "x",
    });
    expect(none).toBeNull();
  });

  it("uses the configured provider and model first", async () => {
    const { port, calls } = fakeOneShot({ codex: "Short title" });
    await service(port, { utilityModel: { provider: "codex", model: "small" } }).sessionTitle({
      session: sampleSession,
      finalMessage: null,
      firstMessage: "hello",
    });
    expect(calls[0]).toEqual({ providerId: "codex", model: "small" });
  });

  it("respects job toggles", async () => {
    const { port, calls } = fakeOneShot({ claude: "x" });
    const off = {
      utilityModel: { jobs: { sessionTitles: false, followups: false, readAloudSummary: false } },
    };
    const svc = service(port, off);
    expect(
      await svc.sessionTitle({ session: sampleSession, finalMessage: "a", firstMessage: "b" }),
    ).toBeNull();
    expect(await svc.suggestFollowups({ session: sampleSession, finalMessage: "a" })).toBeNull();
    expect((await svc.speechSummary("a ".repeat(400))).source).toBe("plain");
    expect(calls).toHaveLength(0);
  });

  it("compresses long messages for read-aloud and keeps short ones as plain text", async () => {
    const { port } = fakeOneShot({ claude: "I fixed the bug and added tests." });
    const svc = service(port);
    expect(await svc.speechSummary("**Done.** See `foo`.")).toEqual({
      text: "Done. See foo.",
      source: "plain",
    });
    const long = `## Summary\n${"I changed many things. ".repeat(30)}\n\`\`\`ts\ncode()\n\`\`\``;
    expect(await svc.speechSummary(long)).toEqual({
      text: "I fixed the bug and added tests.",
      source: "utility",
    });
  });
});

describe("plainSpeech", () => {
  it("strips markdown and code", () => {
    expect(plainSpeech("# Title\n- one\n- [link](http://x)\n```js\nx()\n```\nend")).toBe(
      "Title one link end",
    );
  });
});
