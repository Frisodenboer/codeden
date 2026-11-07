import { writeFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  deadline,
  nearestAspectRatio,
  normalizeRequest,
  orientationOf,
  parseSize,
  readReferenceImages,
  requestedRatio,
} from "../../src/image/request";
import { fakePng, tempDir } from "./helpers";

const base = { prompt: "a cat", outputDir: path.resolve("/tmp/out") };

describe("request validation", () => {
  it("applies defaults", () => {
    expect(normalizeRequest("codex", base)).toMatchObject({
      count: 1,
      fileStem: "image",
      referenceImages: [],
    });
  });

  it.each([
    [{ prompt: "  " }, /prompt/],
    [{ count: 0 }, /count/],
    [{ count: 5 }, /count/],
    [{ count: 1.5 }, /count/],
    [{ aspectRatio: "7:5" as never }, /aspect ratio/],
    [{ size: "big" }, /size/],
    [{ outputDir: "relative/dir" }, /absolute/],
    [{ referenceImages: ["rel.png"] }, /absolute/],
  ])("rejects %o", (patch, message) => {
    expect(() => normalizeRequest("openai", { ...base, ...patch })).toThrow(message);
    try {
      normalizeRequest("openai", { ...base, ...patch });
    } catch (error) {
      expect(error).toMatchObject({ code: "invalid_request", engine: "openai", retryable: false });
    }
  });

  it("parses sizes", () => {
    expect(parseSize("1024x1536")).toEqual({ kind: "pixels", width: 1024, height: 1536 });
    expect(parseSize("2k")).toEqual({ kind: "class", value: "2K" });
    expect(parseSize("3K")).toBeUndefined();
    expect(parseSize("auto")).toBeUndefined();
  });

  it("derives ratios and orientation", () => {
    expect(requestedRatio({ size: "1536x1024" })).toBe(1.5);
    expect(requestedRatio({ aspectRatio: "9:16" })).toBeCloseTo(0.5625);
    expect(requestedRatio({ size: "1024x1024", aspectRatio: "16:9" })).toBe(1);
    expect(requestedRatio({})).toBeUndefined();
    expect(orientationOf(1.5)).toBe("landscape");
    expect(orientationOf(0.5)).toBe("portrait");
    expect(orientationOf(1.05)).toBe("square");
    expect(nearestAspectRatio(1920 / 1080, ["1:1", "16:9", "4:3"])).toBe("16:9");
    expect(nearestAspectRatio(1 / 2, ["1:1", "2:3", "9:16"])).toBe("9:16");
  });
});

describe("reference images", () => {
  it("reads and types images, rejecting missing or non-image files", async () => {
    const dir = tempDir();
    const png = path.join(dir, "a.png");
    const txt = path.join(dir, "a.txt");
    writeFileSync(png, fakePng(4, 4));
    writeFileSync(txt, "not an image");
    const [ref] = await readReferenceImages("gemini", [png]);
    expect(ref).toMatchObject({ path: png, mimeType: "image/png" });
    await expect(readReferenceImages("gemini", [txt])).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(readReferenceImages("gemini", [path.join(dir, "none.png")])).rejects.toMatchObject(
      {
        code: "io",
      },
    );
  });
});

describe("deadline", () => {
  it("aborts with a timeout error", async () => {
    const { signal, dispose } = deadline("codex", 5);
    await new Promise((r) => setTimeout(r, 30));
    expect(signal.reason).toMatchObject({ code: "timeout", engine: "codex", retryable: true });
    dispose();
  });

  it("forwards the caller's abort", () => {
    const outer = new AbortController();
    const { signal, dispose } = deadline("openai", 10_000, outer.signal);
    outer.abort();
    expect(signal.reason).toMatchObject({ code: "aborted", engine: "openai" });
    dispose();
    const pre = deadline("openai", 10_000, AbortSignal.abort());
    expect(pre.signal.aborted).toBe(true);
    pre.dispose();
  });
});
