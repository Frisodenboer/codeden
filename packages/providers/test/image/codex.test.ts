import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ProviderStatus } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import {
  buildCodexImagePrompt,
  CodexImageEngine,
  codexUnavailableReason,
} from "../../src/image/codex";
import { codexImageConfig, denyServerRequest, runCodexImageTurn } from "../../src/image/codex-turn";
import { agentMessage, fakeCodex, fakePng, imageItem, tempDir, turnCompleted } from "./helpers";

const status = (patch: Partial<ProviderStatus> = {}): ProviderStatus => ({
  providerId: "codex",
  installed: true,
  version: "0.160.1",
  executablePath: "codex",
  loggedIn: true,
  authMethod: "chatgpt",
  account: null,
  loginExpiresAt: null,
  supported: true,
  issues: [],
  checkedAt: new Date().toISOString(),
  ...patch,
});

const signal = () => new AbortController().signal;

describe("Codex image prompt and config", () => {
  it("describes count, shape, quality and references", () => {
    const one = buildCodexImagePrompt({ prompt: " a fox ", count: 1, referenceImages: [] });
    expect(one).toBe(
      "Generate one image with your built-in image generation tool.\nDo not run commands or use any other tool.\n\nImage description:\na fox",
    );
    const many = buildCodexImagePrompt({
      prompt: "a fox",
      count: 3,
      aspectRatio: "16:9",
      quality: "high",
      referenceImages: ["/a.png"],
    });
    expect(many).toContain("call the tool 3 times");
    expect(many).toContain("Shape: landscape (aspect ratio 16:9, 1536x1024).");
    expect(many).toContain("Quality: high.");
    expect(many).toContain("attached image as the reference");
    expect(
      buildCodexImagePrompt({ prompt: "x", count: 1, size: "1024x1536", referenceImages: [] }),
    ).toContain("Size: 1024x1536 (portrait).");
  });

  it("turns off MCP servers, plugins and other tools", () => {
    const config = codexImageConfig(["vidiq", "node_repl", "bad name"]);
    expect(config).toMatchObject({
      "features.image_generation": true,
      "features.plugins": false,
      "features.apps": false,
      web_search: "disabled",
      "mcp_servers.vidiq.enabled": false,
      "mcp_servers.node_repl.enabled": false,
    });
    expect(config).not.toHaveProperty("mcp_servers.bad name.enabled");
  });

  it("denies approvals and questions", async () => {
    expect(
      await denyServerRequest({ method: "item/commandExecution/requestApproval" } as never),
    ).toEqual({
      decision: "decline",
    });
    expect(await denyServerRequest({ method: "item/tool/requestUserInput" } as never)).toEqual({
      answers: {},
    });
    await expect(denyServerRequest({ method: "item/tool/call" } as never)).rejects.toThrow(
      /do not handle/,
    );
  });

  it("explains why Codex is unusable", () => {
    expect(codexUnavailableReason(status())).toBeUndefined();
    expect(codexUnavailableReason(status({ loggedIn: false }))).toMatch(/not logged in/);
    expect(codexUnavailableReason(status({ installed: false }))).toMatch(/not installed/);
    expect(
      codexUnavailableReason(
        status({ supported: false, issues: [{ code: "version_unsupported", message: "Too old" }] }),
      ),
    ).toBe("Too old");
  });
});

describe("runCodexImageTurn", () => {
  it("starts a restricted ephemeral thread and returns as soon as the images arrived", async () => {
    const png = fakePng(1536, 1024);
    const fake = fakeCodex(
      ({ threadId }) => [imageItem("other-thread", png), imageItem(threadId, png)],
      {
        servers: ["notion"],
        model: "gpt-x",
      },
    );
    const result = await runCodexImageTurn(fake.connect, {
      prompt: "p",
      referenceImages: ["/ref.png"],
      count: 1,
      signal: signal(),
    });
    expect(result.images).toHaveLength(1);
    expect(result.model).toBe("gpt-x");
    expect(result.images[0]?.revisedPrompt).toBe("revised");
    expect(fake.calls.map((c) => c.method)).toEqual(["config/read", "thread/start", "turn/start"]);
    const start = fake.calls[1]?.params as Record<string, unknown>;
    expect(start).toMatchObject({ ephemeral: true, sandbox: "read-only", approvalPolicy: "never" });
    expect(start.config).toMatchObject({ "mcp_servers.notion.enabled": false });
    const turn = fake.calls[2]?.params as { input: unknown[]; effort: string };
    expect(turn.input[0]).toEqual({ type: "localImage", path: "/ref.png" });
    expect(turn.effort).toBe("low");
    await new Promise((r) => setTimeout(r, 5));
    expect(fake.closed()).toBe(1);
  });

  it("collects several images in one turn", async () => {
    const fake = fakeCodex(({ threadId }) => [
      imageItem(threadId, fakePng(1, 1)),
      imageItem(threadId, fakePng(2, 2)),
      turnCompleted(threadId),
    ]);
    const result = await runCodexImageTurn(fake.connect, {
      prompt: "p",
      referenceImages: [],
      count: 2,
      signal: signal(),
    });
    expect(result.images).toHaveLength(2);
  });

  it("fails with no_image when the turn ends without an image", async () => {
    const fake = fakeCodex(({ threadId }) => [
      agentMessage(threadId, "I cannot draw that."),
      turnCompleted(threadId),
    ]);
    await expect(
      runCodexImageTurn(fake.connect, {
        prompt: "p",
        referenceImages: [],
        count: 1,
        signal: signal(),
      }),
    ).rejects.toMatchObject({
      code: "no_image",
      message: expect.stringContaining("I cannot draw that."),
    });
  });

  it("maps usage limits and turn errors", async () => {
    const limited = fakeCodex(({ threadId }) => [
      imageItem(threadId, "", {
        failure: { type: "usageLimitExceeded", limitId: "x", resetsAt: 1_800_000_000 },
      }),
    ]);
    const error = await runCodexImageTurn(limited.connect, {
      prompt: "p",
      referenceImages: [],
      count: 1,
      signal: signal(),
    }).catch((e) => e);
    expect(error).toMatchObject({ code: "rate_limited", retryable: true });
    expect(error.details.retryAfter.getTime()).toBe(1_800_000_000_000);

    const failed = fakeCodex(({ threadId }) => [
      turnCompleted(threadId, "failed", {
        message: "Unauthorized",
        codexErrorInfo: "unauthorized",
      }),
    ]);
    await expect(
      runCodexImageTurn(failed.connect, {
        prompt: "p",
        referenceImages: [],
        count: 1,
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: "auth" });
  });

  it("aborts a hanging turn and closes the server", async () => {
    const fake = fakeCodex(() => []);
    const controller = new AbortController();
    const pending = runCodexImageTurn(fake.connect, {
      prompt: "p",
      referenceImages: [],
      count: 1,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(fake.closed()).toBe(1);
  });
});

describe("CodexImageEngine", () => {
  it("writes the images and removes Codex's cached copy", async () => {
    const codexHome = tempDir();
    const cacheDir = path.join(codexHome, "generated_images", "thread-1");
    mkdirSync(cacheDir, { recursive: true });
    const cached = path.join(cacheDir, "img.png");
    writeFileSync(cached, "cached");
    const outside = path.join(tempDir(), "keep.png");
    writeFileSync(outside, "keep");
    const png = fakePng(1254, 1254);
    const fake = fakeCodex(({ threadId }) => [
      imageItem(threadId, png, { savedPath: cached }),
      imageItem(threadId, png, { savedPath: outside }),
    ]);
    const engine = new CodexImageEngine({ connect: fake.connect, codexHome });
    const out = path.join(tempDir(), "out");
    const result = await engine.generate({
      prompt: "a fox",
      count: 2,
      outputDir: out,
      fileStem: "fox",
    });
    expect(result.files.map((f) => path.basename(f))).toEqual(["fox.png", "fox-2.png"]);
    expect(readFileSync(result.files[0] as string).equals(png)).toBe(true);
    expect(result).toMatchObject({ engine: "codex", model: "gpt-test", revisedPrompt: "revised" });
    expect(existsSync(cached)).toBe(false);
    expect(existsSync(cacheDir)).toBe(false);
    expect(existsSync(outside)).toBe(true);
  });

  it("validates reference images before starting Codex", async () => {
    const fake = fakeCodex(() => []);
    const engine = new CodexImageEngine({ connect: fake.connect });
    await expect(
      engine.generate({
        prompt: "x",
        outputDir: tempDir(),
        referenceImages: [path.join(tempDir(), "no.png")],
      }),
    ).rejects.toMatchObject({ code: "io" });
    expect(fake.calls).toHaveLength(0);
  });

  it("times out", async () => {
    const fake = fakeCodex(() => []);
    const engine = new CodexImageEngine({ connect: fake.connect });
    await expect(
      engine.generate({ prompt: "x", outputDir: tempDir(), timeoutMs: 20 }),
    ).rejects.toMatchObject({
      code: "timeout",
    });
  });

  it("detects login and the provider's image capability", async () => {
    const ok = fakeCodex(() => []);
    expect(
      await new CodexImageEngine({
        connect: ok.connect,
        detectStatus: async () => status(),
      }).detect(),
    ).toMatchObject({ available: true });
    expect(ok.calls.map((c) => c.method)).toEqual(["modelProvider/capabilities/read"]);
    expect(ok.closed()).toBe(1);

    const noCap = fakeCodex(() => [], { capabilities: { imageGeneration: false } });
    expect(
      await new CodexImageEngine({
        connect: noCap.connect,
        detectStatus: async () => status(),
      }).detect(),
    ).toMatchObject({ available: false, reason: expect.stringContaining("does not support") });

    const loggedOut = fakeCodex(() => []);
    expect(
      await new CodexImageEngine({
        connect: loggedOut.connect,
        detectStatus: async () => status({ loggedIn: false }),
      }).detect(),
    ).toMatchObject({ available: false, reason: expect.stringContaining("codex login") });
    expect(loggedOut.calls).toHaveLength(0);

    const broken = new CodexImageEngine({
      detectStatus: async () => status(),
      connect: async () => {
        throw new Error("spawn failed");
      },
    });
    expect(await broken.detect()).toMatchObject({
      available: false,
      reason: expect.stringContaining("spawn failed"),
    });
  });
});
