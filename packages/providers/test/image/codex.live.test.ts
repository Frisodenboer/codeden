import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CodexImageEngine } from "../../src/image/codex";
import { imageInfo } from "../../src/image/image-file";
import { tempDir } from "./helpers";

const LIVE = process.env.CODEDEN_LIVE === "1";

/** Real Codex turn under the user's own login (uses a little of the subscription). */
describe.skipIf(!LIVE)("Codex image engine (live)", () => {
  const engine = new CodexImageEngine();

  it("detects a logged-in Codex with image generation", { timeout: 60_000 }, async () => {
    expect(await engine.detect()).toMatchObject({ available: true });
  });

  it("generates a square PNG at the requested path", { timeout: 300_000 }, async () => {
    const outputDir = path.join(tempDir("codeden-image-live-"), "assets");
    const started = Date.now();
    const result = await engine.generate({
      prompt:
        "A small flat vector icon of a friendly fox head, orange and white, on a plain cream background.",
      aspectRatio: "1:1",
      outputDir,
      fileStem: "fox",
    });
    const elapsed = Date.now() - started;
    expect(result.engine).toBe("codex");
    expect(result.files).toEqual([path.join(outputDir, "fox.png")]);
    const file = result.files[0] as string;
    expect(statSync(file).size).toBeGreaterThan(1000);
    const meta = imageInfo(readFileSync(file));
    expect(meta?.format).toBe("png");
    expect(meta?.width).toBeGreaterThanOrEqual(256);
    expect(meta?.height).toBeGreaterThanOrEqual(256);
    // Square was requested; Codex currently returns 1254x1254 for square prompts.
    expect(Math.abs((meta?.width ?? 0) / (meta?.height ?? 1) - 1)).toBeLessThan(0.1);
    console.log(
      `[codex image] ${file} ${meta?.width}x${meta?.height} model=${result.model} ${elapsed}ms`,
    );
  });
});
