import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildOpenAIRequest,
  OPENAI_IMAGE_MODEL,
  OpenAIImageEngine,
  openAiSize,
} from "../../src/image/openai";
import { fakeJpeg, fakePng, tempDir } from "./helpers";

describe("OpenAI request shaping", () => {
  it("passes exact sizes to gpt-image-2 and maps the rest", () => {
    expect(openAiSize({ size: "1536x864" }, "gpt-image-2")).toBe("1536x864");
    expect(openAiSize({ size: "1536x864" }, "gpt-image-1.5")).toBe("1536x1024");
    expect(openAiSize({ size: "1000x1000" }, "gpt-image-2")).toBe("1024x1024");
    expect(openAiSize({ size: "4000x1000" }, "gpt-image-2")).toBe("1536x1024");
    expect(openAiSize({ aspectRatio: "9:16" }, "gpt-image-2")).toBe("1024x1536");
    expect(openAiSize({ size: "2K" }, "gpt-image-2")).toBeUndefined();
    expect(openAiSize({}, "gpt-image-2")).toBeUndefined();
  });

  it("builds a generations body", () => {
    expect(
      buildOpenAIRequest(
        { prompt: "a fox", count: 2, quality: "high", aspectRatio: "16:9" },
        "gpt-image-2",
        [],
      ),
    ).toEqual({
      path: "/images/generations",
      body: {
        model: "gpt-image-2",
        prompt: "a fox",
        n: 2,
        output_format: "png",
        size: "1536x1024",
        quality: "high",
      },
    });
    const auto = buildOpenAIRequest({ prompt: "x", count: 1, quality: "auto" }, "gpt-image-2", []);
    expect(auto.body).not.toHaveProperty("quality");
    expect(auto.body).not.toHaveProperty("size");
  });

  it("uses the edits endpoint with data URLs for references", () => {
    const req = buildOpenAIRequest({ prompt: "edit", count: 1 }, "gpt-image-2", [
      { mimeType: "image/jpeg", data: Buffer.from("abc") },
    ]);
    expect(req.path).toBe("/images/edits");
    expect(req.body.images).toEqual([{ image_url: "data:image/jpeg;base64,YWJj" }]);
  });
});

describe("OpenAIImageEngine", () => {
  it("generates, writes files and returns the revised prompt", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const engine = new OpenAIImageEngine({
      apiKey: "sk-test",
      fetch: async (url, init) => {
        calls.push({ url, init });
        return Response.json({
          data: [
            {
              b64_json: fakePng(1024, 1024).toString("base64"),
              revised_prompt: "a red fox, studio",
            },
            { b64_json: fakeJpeg(1024, 1024).toString("base64") },
          ],
        });
      },
    });
    const dir = tempDir();
    const result = await engine.generate({
      prompt: "a fox",
      count: 2,
      outputDir: dir,
      fileStem: "fox",
    });
    expect(result).toMatchObject({
      engine: "openai",
      model: OPENAI_IMAGE_MODEL,
      revisedPrompt: "a red fox, studio",
    });
    expect(result.files.map((f) => path.basename(f))).toEqual(["fox.png", "fox-2.jpg"]);
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/images/generations");
    expect((calls[0]?.init.headers as Record<string, string> | undefined)?.authorization).toBe(
      "Bearer sk-test",
    );
  });

  it("sends reference images to /images/edits", async () => {
    let url = "";
    let body: Record<string, unknown> = {};
    const engine = new OpenAIImageEngine({
      apiKey: "k",
      baseUrl: "http://127.0.0.1:9/v1/",
      fetch: async (u, init) => {
        url = u;
        body = JSON.parse(init.body as string);
        return Response.json({ data: [{ b64_json: fakePng(8, 8).toString("base64") }] });
      },
    });
    const dir = tempDir();
    const ref = path.join(dir, "ref.png");
    writeFileSync(ref, fakePng(2, 2));
    await engine.generate({ prompt: "make it blue", referenceImages: [ref], outputDir: dir });
    expect(url).toBe("http://127.0.0.1:9/v1/images/edits");
    expect((body.images as { image_url: string }[])[0]?.image_url).toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it("maps errors and empty replies", async () => {
    const reply = (r: Response) => new OpenAIImageEngine({ apiKey: "k", fetch: async () => r });
    const dir = tempDir();
    await expect(
      reply(
        new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 }),
      ).generate({
        prompt: "x",
        outputDir: dir,
      }),
    ).rejects.toMatchObject({ code: "auth", message: expect.stringContaining("bad key") });
    await expect(
      reply(
        new Response(JSON.stringify({ error: { message: "Rejected by the safety system" } }), {
          status: 400,
        }),
      ).generate({ prompt: "x", outputDir: dir }),
    ).rejects.toMatchObject({ code: "content_policy" });
    await expect(
      reply(Response.json({ data: [] })).generate({ prompt: "x", outputDir: dir }),
    ).rejects.toMatchObject({
      code: "no_image",
    });
    await expect(
      reply(new Response("oops", { status: 500 })).generate({ prompt: "x", outputDir: dir }),
    ).rejects.toMatchObject({ code: "provider_error", retryable: true });
  });

  it("reads keys lazily and reports a missing key", async () => {
    let reads = 0;
    const engine = new OpenAIImageEngine({
      apiKey: () => {
        reads++;
        return "";
      },
    });
    expect(reads).toBe(0);
    expect(await engine.detect()).toMatchObject({ available: false });
    expect(reads).toBe(1);
  });
});
