import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ImageGenerationError } from "../../src/image/errors";
import { imageInfo, writeImages } from "../../src/image/image-file";
import { imageFileNames, resolveImageOutput, sanitizeFileStem } from "../../src/image/paths";
import { fakeJpeg, fakePng } from "./helpers";

describe("resolveImageOutput (posix)", () => {
  const root = "/home/u/wt/proj";
  const r = (p: string | undefined) => resolveImageOutput(root, p, { platform: "linux" });

  it("defaults to generated-images/image", () => {
    expect(r(undefined)).toEqual({ outputDir: `${root}/generated-images`, fileStem: "image" });
    expect(r("  ")).toEqual({ outputDir: `${root}/generated-images`, fileStem: "image" });
  });

  it("splits a file path into dir + stem", () => {
    expect(r("public/hero.png")).toEqual({ outputDir: `${root}/public`, fileStem: "hero" });
    expect(r(`${root}/assets/logo.JPEG`)).toEqual({
      outputDir: `${root}/assets`,
      fileStem: "logo",
    });
  });

  it("treats directories and non-image names as directories", () => {
    expect(r("assets/img/")).toEqual({ outputDir: `${root}/assets/img`, fileStem: "image" });
    expect(r("assets")).toEqual({ outputDir: `${root}/assets`, fileStem: "image" });
    expect(r("notes.txt")).toEqual({ outputDir: `${root}/notes.txt`, fileStem: "image" });
    expect(
      resolveImageOutput(root, "x/", { platform: "linux", defaultStem: "hero" }).fileStem,
    ).toBe("hero");
  });

  it("rejects escapes, .git and NUL bytes", () => {
    expect(() => r("../other/a.png")).toThrow(/inside the worktree/);
    expect(() => r("/etc/passwd.png")).toThrow(/inside the worktree/);
    expect(() => r("a/../../b.png")).toThrow(/inside the worktree/);
    expect(() => r(".git/hooks/x.png")).toThrow(/\.git/);
    expect(() => r("a\0.png")).toThrow(/NUL/);
    expect(() => resolveImageOutput("relative", "a.png", { platform: "linux" })).toThrow(
      /absolute/,
    );
  });
});

describe("resolveImageOutput (win32)", () => {
  const root = "C:\\wt\\proj";
  const r = (p: string) => resolveImageOutput(root, p, { platform: "win32" });

  it("handles backslashes and case-insensitive roots", () => {
    expect(r("public\\hero.png")).toEqual({ outputDir: "C:\\wt\\proj\\public", fileStem: "hero" });
    expect(r("c:\\WT\\proj\\a\\b.webp")).toEqual({ outputDir: "c:\\WT\\proj\\a", fileStem: "b" });
  });

  it("rejects other drives, traversal and .GIT", () => {
    expect(() => r("D:\\x.png")).toThrow(/inside the worktree/);
    expect(() => r("..\\x.png")).toThrow(/inside the worktree/);
    expect(() => r(".GIT\\x.png")).toThrow(/\.git/);
  });

  it("makes reserved device names safe", () => {
    expect(r("con.png").fileStem).toBe("_con");
  });
});

describe("file names", () => {
  it("sanitizes stems", () => {
    expect(sanitizeFileStem('a<b>:c"d|e?f*g')).toBe("a-b--c-d-e-f-g");
    expect(sanitizeFileStem(" ..hidden.. ")).toBe("hidden");
    expect(sanitizeFileStem("")).toBe("image");
    expect(sanitizeFileStem("x".repeat(200))).toHaveLength(80);
    expect(sanitizeFileStem("NUL")).toBe("_NUL");
  });

  it("numbers extra images", () => {
    expect(imageFileNames("hero", [".png", ".png", ".jpg"])).toEqual([
      "hero.png",
      "hero-2.png",
      "hero-3.jpg",
    ]);
  });
});

describe("image files", () => {
  it("sniffs PNG, JPEG, GIF and WebP sizes", () => {
    expect(imageInfo(fakePng(1536, 1024))).toMatchObject({
      format: "png",
      width: 1536,
      height: 1024,
    });
    expect(imageInfo(fakeJpeg(640, 480))).toMatchObject({
      format: "jpeg",
      width: 640,
      height: 480,
    });
    const gif = Buffer.alloc(16);
    gif.write("GIF89a", 0, "ascii");
    gif.writeUInt16LE(32, 6);
    gif.writeUInt16LE(16, 8);
    expect(imageInfo(gif)).toMatchObject({ format: "gif", width: 32, height: 16 });
    const webp = Buffer.alloc(32);
    webp.write("RIFF", 0, "ascii");
    webp.write("WEBPVP8X", 8, "ascii");
    webp.writeUIntLE(99, 24, 3);
    webp.writeUIntLE(49, 27, 3);
    expect(imageInfo(webp)).toMatchObject({ format: "webp", width: 100, height: 50 });
    expect(imageInfo(Buffer.from("hello world, not an image"))).toBeUndefined();
  });

  it("writes images with extensions that follow the bytes", async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "codeden-img-")), "nested", "out");
    const files = await writeImages("openai", [fakePng(8, 8), fakeJpeg(8, 8)], dir, "hero");
    expect(files.map((f) => path.basename(f))).toEqual(["hero.png", "hero-2.jpg"]);
    expect(readFileSync(files[0] as string).equals(fakePng(8, 8))).toBe(true);
  });

  it("refuses non-image bytes and reports write failures as io", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "codeden-img-"));
    await expect(writeImages("gemini", [Buffer.from("nope")], dir, "a")).rejects.toMatchObject({
      code: "no_image",
    });
    const file = path.join(dir, "blocker");
    writeFileSync(file, "x");
    const error = await writeImages("gemini", [fakePng(1, 1)], path.join(file, "sub"), "a").catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ImageGenerationError);
    expect(error).toMatchObject({ code: "io", engine: "gemini" });
  });
});
