import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildGeminiRequest,
  GEMINI_IMAGE_MODEL,
  GeminiImageEngine,
  parseGeminiImages,
} from "../../src/image/gemini";
import { imageInfo } from "../../src/image/image-file";
import { fakePng, tempDir } from "./helpers";

type Call = { url: string; init: RequestInit };

function mockFetch(reply: (call: Call) => Response) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return reply(call);
  };
  return { fetch, calls };
}

const imageReply = (png: Buffer, extraParts: unknown[] = []) =>
  Response.json({
    candidates: [
      {
        content: {
          parts: [
            ...extraParts,
            { text: "Here you go" },
            { inlineData: { mimeType: "image/png", data: png.toString("base64") } },
          ],
        },
        finishReason: "STOP",
      },
    ],
  });

describe("Gemini request shaping", () => {
  it("sends the prompt, aspect ratio and modalities", () => {
    expect(buildGeminiRequest({ prompt: "a fox", aspectRatio: "16:9" }, [])).toEqual({
      contents: [{ role: "user", parts: [{ text: "a fox" }] }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "16:9" },
      },
    });
  });

  it("maps pixel sizes to the nearest ratio and a resolution class", () => {
    const body = buildGeminiRequest({ prompt: "x", size: "1920x1080" }, []);
    expect(body.generationConfig).toMatchObject({
      imageConfig: { aspectRatio: "16:9", imageSize: "2K" },
    });
    const small = buildGeminiRequest({ prompt: "x", size: "1024x1024", aspectRatio: "9:16" }, []);
    expect(small.generationConfig).toMatchObject({
      imageConfig: { aspectRatio: "1:1", imageSize: "1K" },
    });
    const cls = buildGeminiRequest({ prompt: "x", size: "4K", aspectRatio: "3:2" }, []);
    expect(cls.generationConfig).toMatchObject({
      imageConfig: { aspectRatio: "3:2", imageSize: "4K" },
    });
    const none = buildGeminiRequest({ prompt: "x" }, []);
    expect(none.generationConfig).toEqual({ responseModalities: ["TEXT", "IMAGE"] });
  });

  it("inlines reference images", () => {
    const body = buildGeminiRequest({ prompt: "edit" }, [
      { mimeType: "image/png", data: Buffer.from("abc") },
    ]);
    expect(body.contents).toEqual([
      {
        role: "user",
        parts: [{ text: "edit" }, { inlineData: { mimeType: "image/png", data: "YWJj" } }],
      },
    ]);
  });

  it("skips thought images and maps refusals", () => {
    const final = fakePng(10, 10);
    const thought = fakePng(1, 1);
    const images = parseGeminiImages({
      candidates: [
        {
          content: {
            parts: [
              {
                thought: true,
                inlineData: { mimeType: "image/png", data: thought.toString("base64") },
              },
              { inlineData: { mimeType: "image/png", data: final.toString("base64") } },
            ],
          },
        },
      ],
    });
    expect(images).toHaveLength(1);
    expect(imageInfo(images[0] as Buffer)?.width).toBe(10);
    expect(() => parseGeminiImages({ promptFeedback: { blockReason: "SAFETY" } })).toThrow(
      expect.objectContaining({ code: "content_policy" }),
    );
    expect(() => parseGeminiImages({ candidates: [{ finishReason: "IMAGE_SAFETY" }] })).toThrow(
      expect.objectContaining({ code: "content_policy" }),
    );
    expect(() =>
      parseGeminiImages({ candidates: [{ content: { parts: [{ text: "I can't" }] } }] }),
    ).toThrow(
      expect.objectContaining({ code: "no_image", message: expect.stringContaining("I can't") }),
    );
  });
});

describe("GeminiImageEngine", () => {
  it("is unavailable without a key", async () => {
    const engine = new GeminiImageEngine();
    expect(await engine.detect()).toMatchObject({ available: false });
    await expect(engine.generate({ prompt: "x", outputDir: tempDir() })).rejects.toMatchObject({
      code: "unavailable",
    });
    const keyed = new GeminiImageEngine({ apiKey: async () => "k" });
    expect(await keyed.detect()).toEqual({ available: true });
  });

  it("makes one request per image and writes the files", async () => {
    const { fetch, calls } = mockFetch(() => imageReply(fakePng(1024, 1024)));
    const dir = tempDir();
    const ref = path.join(dir, "ref.png");
    writeFileSync(ref, fakePng(2, 2));
    const engine = new GeminiImageEngine({ apiKey: "secret-key", fetch });
    const result = await engine.generate({
      prompt: "a robot",
      count: 2,
      aspectRatio: "1:1",
      referenceImages: [ref],
      outputDir: path.join(dir, "out"),
      fileStem: "robot",
    });
    expect(result.engine).toBe("gemini");
    expect(result.model).toBe(GEMINI_IMAGE_MODEL);
    expect(result.files.map((f) => path.basename(f))).toEqual(["robot.png", "robot-2.png"]);
    for (const f of result.files) expect(existsSync(f)).toBe(true);
    expect(calls).toHaveLength(2);
    const call = calls[0] as Call;
    expect(call.url).toBe(
      `https://generativelanguage.googleapis.com/v1/models/${GEMINI_IMAGE_MODEL}:generateContent`,
    );
    expect((call.init.headers as Record<string, string>)["x-goog-api-key"]).toBe("secret-key");
    const body = JSON.parse(call.init.body as string);
    expect(body.contents[0].parts).toHaveLength(2);
    expect(body.generationConfig.imageConfig).toEqual({ aspectRatio: "1:1" });
  });

  it("maps HTTP errors", async () => {
    const limited = mockFetch(
      () =>
        new Response(JSON.stringify({ error: { message: "Quota exceeded" } }), {
          status: 429,
          headers: { "retry-after": "30" },
        }),
    );
    const engine = new GeminiImageEngine({ apiKey: "k", fetch: limited.fetch });
    const error = await engine.generate({ prompt: "x", outputDir: tempDir() }).catch((e) => e);
    expect(error).toMatchObject({
      code: "rate_limited",
      retryable: true,
      details: { status: 429 },
    });
    expect(error.message).toContain("Quota exceeded");
    expect(error.details.retryAfter).toBeInstanceOf(Date);

    const denied = mockFetch(() => new Response("nope", { status: 403 }));
    await expect(
      new GeminiImageEngine({ apiKey: "k", fetch: denied.fetch }).generate({
        prompt: "x",
        outputDir: tempDir(),
      }),
    ).rejects.toMatchObject({ code: "auth" });
  });

  it("honours abort and timeouts", async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) => {
        if (init.signal?.aborted) return reject(init.signal.reason);
        init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
      });
    const engine = new GeminiImageEngine({ apiKey: "k", fetch: hang });
    const controller = new AbortController();
    const pending = engine.generate({
      prompt: "x",
      outputDir: tempDir(),
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    await expect(
      engine.generate({ prompt: "x", outputDir: tempDir(), timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: "timeout" });
  });
});
