import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WhisperModelId } from "@codeden/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ServiceError } from "../src/services/errors";
import type { ModelPin, RuntimePin } from "../src/services/voice/local/catalog";
import { MODEL_PINS, RUNTIME_PINS } from "../src/services/voice/local/catalog";
import { cleanTranscript, LocalSttService } from "../src/services/voice/local/local-stt-service";
import type { LoadWhisperRuntime } from "../src/services/voice/local/runtime";
import { extractTgzEntry } from "../src/services/voice/local/tgz";
import { parseWav } from "../src/services/voice/local/wav";
import { SettingsStore } from "../src/settings-store";
import {
  type FakeDownloads,
  makeTgz,
  makeWav,
  sha256,
  startFakeDownloads,
} from "./support/fake-downloads";

const ADDON = Buffer.from("fake whisper addon bytes");
const TARBALL = makeTgz({ "package/package.json": Buffer.from("{}"), "package/index.node": ADDON });

/** A fake runtime that records what it loaded and echoes what it heard. */
function fakeRuntime(calls: string[]): LoadWhisperRuntime {
  return async (addonPath) => {
    calls.push(`runtime:${readFileSync(addonPath).toString()}`);
    return {
      async loadModel(modelPath) {
        calls.push(`load:${modelPath.split(/[\\/]/).pop()}`);
        return {
          async transcribe(pcm, { language }) {
            calls.push(`transcribe:${language}`);
            return { text: ` [BLANK_AUDIO] heard ${pcm.byteLength} bytes `, language: null };
          },
          async release() {
            calls.push("release");
          },
        };
      },
    };
  };
}

describe("local Whisper service", () => {
  let fake: FakeDownloads;
  let dir: string;
  let models: Record<string, Buffer>;
  let calls: string[];

  beforeAll(async () => {
    fake = await startFakeDownloads();
  });
  afterAll(() => fake.close());

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "codeden-whisper-"));
    calls = [];
    fake.files.clear();
    fake.ranges.clear();
    fake.files.set("/runtime.tgz", { body: TARBALL });
    models = { "base.en": randomBytes(50_000), small: randomBytes(30_000) };
    for (const [id, body] of Object.entries(models)) fake.files.set(`/${id}.bin`, { body });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const runtimePin = (over: Partial<RuntimePin> = {}): RuntimePin => ({
    version: "9.9.9",
    url: `${fake.url}/runtime.tgz`,
    sha256: sha256(TARBALL),
    bytes: TARBALL.length,
    entry: "package/index.node",
    ...over,
  });
  const modelPin = (id: WhisperModelId, over: Partial<ModelPin> = {}): ModelPin => {
    const body = models[id] ?? Buffer.alloc(0);
    return {
      id,
      file: `ggml-${id}.bin`,
      url: `${fake.url}/${id}.bin`,
      sha256: sha256(body),
      bytes: body.length,
      label: id,
      hint: "test",
      englishOnly: id.endsWith(".en"),
      recommended: id === "base.en",
      ...over,
    };
  };
  const service = (opts: { runtime?: RuntimePin; models?: ModelPin[]; platform?: string } = {}) => {
    const settings = new SettingsStore(join(dir, "settings.json"));
    const svc = new LocalSttService({
      runtimeDir: join(dir, "deps", "whisper"),
      modelsDir: join(dir, "models", "whisper"),
      settings,
      platform: opts.platform ?? "test-x64",
      runtimePins: { "test-x64": opts.runtime ?? runtimePin() },
      models: opts.models ?? [modelPin("base.en"), modelPin("small")],
      loadRuntime: fakeRuntime(calls),
      idleUnloadMs: 60_000,
    });
    return { svc, settings };
  };

  it("pins a runtime for all six platforms and checksums for every model", () => {
    expect(Object.keys(RUNTIME_PINS).sort()).toEqual([
      "darwin-arm64",
      "darwin-x64",
      "linux-arm64",
      "linux-x64",
      "win32-arm64",
      "win32-x64",
    ]);
    for (const pin of [...Object.values(RUNTIME_PINS), ...MODEL_PINS]) {
      expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(pin.url).toMatch(/^https:\/\/(registry\.npmjs\.org|huggingface\.co)\//);
    }
    expect(MODEL_PINS.map((m) => m.id)).toEqual([
      "tiny.en",
      "tiny",
      "base.en",
      "base",
      "small.en",
      "small",
    ]);
    expect(MODEL_PINS.filter((m) => m.recommended).map((m) => m.id)).toEqual(["base.en"]);
  });

  it("downloads the runtime and a model, verified, with progress", async () => {
    const { svc } = service();
    const before = svc.status();
    expect(before).toMatchObject({ supported: true, platform: "test-x64" });
    expect(before.runtime).toMatchObject({ state: "missing", totalBytes: TARBALL.length });
    expect(before.models.map((m) => [m.id, m.state])).toEqual([
      ["base.en", "missing"],
      ["small", "missing"],
    ]);
    const started = svc.download("base.en");
    expect(started.models[0]?.state).toBe("downloading");
    await svc.settled();
    const after = svc.status();
    expect(after.runtime).toMatchObject({ state: "installed", error: null });
    expect(after.runtime.sizeOnDisk).toBe(ADDON.length);
    expect(after.models[0]).toMatchObject({
      state: "installed",
      sizeOnDisk: models["base.en"]?.length,
      receivedBytes: models["base.en"]?.length,
    });
    expect(after.models[1]?.state).toBe("missing");
    const addon = join(dir, "deps", "whisper", "9.9.9-test-x64", "whisper.node");
    expect(readFileSync(addon)).toEqual(ADDON);
    expect(readFileSync(join(dir, "models", "whisper", "ggml-base.en.bin"))).toEqual(
      models["base.en"],
    );
    // The archive is not kept once the addon is extracted.
    expect(existsSync(join(dir, "deps", "whisper", ".downloads", "runtime.tgz"))).toBe(false);
    // A second model reuses the installed runtime.
    svc.download("small");
    await svc.settled();
    expect(fake.ranges.get("/runtime.tgz")).toHaveLength(1);
    expect(svc.status().models[1]?.state).toBe("installed");
  });

  it("deletes a download that fails its checksum and reports why", async () => {
    const { svc } = service({ models: [modelPin("base.en", { sha256: "0".repeat(64) })] });
    svc.download("base.en");
    await svc.settled();
    const model = svc.status().models[0];
    expect(model?.state).toBe("failed");
    expect(model?.error).toMatch(/SHA-256/);
    expect(model?.receivedBytes).toBe(0);
    const modelsDir = join(dir, "models", "whisper");
    expect(existsSync(join(modelsDir, "ggml-base.en.bin"))).toBe(false);
    expect(existsSync(join(modelsDir, "ggml-base.en.bin.partial"))).toBe(false);
  });

  it("fails the model too when the runtime checksum is wrong", async () => {
    const { svc } = service({ runtime: runtimePin({ sha256: "f".repeat(64) }) });
    svc.download("base.en");
    await svc.settled();
    const status = svc.status();
    expect(status.runtime.state).toBe("failed");
    expect(status.models[0]).toMatchObject({ state: "failed" });
    expect(status.models[0]?.error).toMatch(/SHA-256/);
  });

  it("resumes a cut download with a range request", async () => {
    const body = models["base.en"] as Buffer;
    fake.files.set("/base.en.bin", { body, cutAfter: 20_000 });
    const { svc } = service();
    svc.download("base.en");
    await svc.settled();
    const cut = svc.status().models[0];
    expect(cut?.state).toBe("failed");
    expect(cut?.receivedBytes).toBe(20_000);
    svc.download("base.en");
    await svc.settled();
    expect(svc.status().models[0]?.state).toBe("installed");
    expect(fake.ranges.get("/base.en.bin")).toEqual([null, "bytes=20000-"]);
    expect(readFileSync(join(dir, "models", "whisper", "ggml-base.en.bin"))).toEqual(body);
  });

  it("starts over when the server ignores the range", async () => {
    const body = models["base.en"] as Buffer;
    fake.files.set("/base.en.bin", { body, cutAfter: 10_000, ignoreRange: true });
    const { svc } = service();
    svc.download("base.en");
    await svc.settled();
    svc.download("base.en");
    await svc.settled();
    expect(svc.status().models[0]?.state).toBe("installed");
    expect(readFileSync(join(dir, "models", "whisper", "ggml-base.en.bin"))).toEqual(body);
  });

  it("cancels a running download and deletes a model", async () => {
    fake.files.set("/base.en.bin", { body: models["base.en"] as Buffer, slowMs: 30 });
    const { svc } = service();
    svc.download("base.en");
    await new Promise((r) => setTimeout(r, 150));
    const cancelled = await svc.remove("base.en");
    expect(cancelled.models[0]).toMatchObject({ state: "missing", receivedBytes: 0, error: null });
    expect(existsSync(join(dir, "models", "whisper", "ggml-base.en.bin.partial"))).toBe(false);

    fake.files.set("/base.en.bin", { body: models["base.en"] as Buffer });
    svc.download("base.en");
    await svc.settled();
    expect(svc.status().models[0]?.state).toBe("installed");
    const removed = await svc.remove("base.en");
    expect(removed.models[0]).toMatchObject({ state: "missing", sizeOnDisk: null });
    expect(existsSync(join(dir, "models", "whisper", "ggml-base.en.bin"))).toBe(false);
  });

  it("is honest on a platform without a runtime", () => {
    const { svc } = service({ platform: "plan9-x64" });
    const status = svc.status();
    expect(status.supported).toBe(false);
    expect(status.unsupportedReason).toMatch(/plan9-x64/);
    expect(() => svc.download("base.en")).toThrow(ServiceError);
  });

  it("transcribes WAV with the chosen model, forcing English for .en models", async () => {
    const { svc, settings } = service();
    const wav = makeWav({ seconds: 1 });
    await expect(svc.transcribe(wav)).rejects.toMatchObject({
      status: 409,
      code: "model_not_installed",
    });
    svc.download("base.en");
    await svc.settled();
    const res = await svc.transcribe(wav, { language: "de-DE" });
    expect(res).toMatchObject({ text: "heard 32000 bytes", language: "en", engine: "local" });
    expect(res.elapsedMs).toBeGreaterThanOrEqual(0);

    settings.update({ voice: { dictation: { local: { model: "small" } } } });
    svc.download("small");
    await svc.settled();
    await svc.transcribe(wav, { language: "de-DE" });
    const auto = await svc.transcribe(wav);
    expect(auto.language).toBeNull();
    expect(calls).toEqual([
      "runtime:fake whisper addon bytes",
      "load:ggml-base.en.bin",
      "transcribe:en",
      "release",
      "runtime:fake whisper addon bytes",
      "load:ggml-small.bin",
      "transcribe:de",
      "transcribe:auto",
    ]);
    await svc.stop();
    expect(calls.at(-1)).toBe("release");
  });

  it("validates uploaded audio before transcribing", () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return error instanceof ServiceError ? `${error.status} ${error.code}` : String(error);
      }
      return "ok";
    };
    expect(code(() => parseWav(makeWav({ seconds: 2 })))).toBe("ok");
    expect(parseWav(makeWav({ seconds: 2 })).durationSec).toBe(2);
    expect(code(() => parseWav(new Uint8Array()))).toBe("400 empty_audio");
    expect(code(() => parseWav(Buffer.from("OggS fake webm audio data....")))).toBe(
      "415 unsupported_audio",
    );
    expect(code(() => parseWav(makeWav({ channels: 2 })))).toBe("415 unsupported_audio");
    expect(code(() => parseWav(makeWav({ rate: 44_100 })))).toBe("415 unsupported_audio");
    expect(code(() => parseWav(makeWav({ bits: 8 })))).toBe("415 unsupported_audio");
    expect(code(() => parseWav(makeWav({ seconds: 121 })))).toBe("413 audio_too_long");
    expect(code(() => parseWav(makeWav({ seconds: 0.05 })))).toBe("400 empty_audio");
    // A writer that left the data size open: whole samples up to the end are used.
    const open = makeWav({ seconds: 1 });
    open.writeUInt32LE(0xffffffff, 40);
    expect(parseWav(Buffer.concat([open, Buffer.from([1])])).pcm.byteLength).toBe(32_000);
  });

  it("extracts only the named entry from a tarball", () => {
    expect(extractTgzEntry(TARBALL, "package/index.node")).toEqual(ADDON);
    expect(() => extractTgzEntry(TARBALL, "package/other.node")).toThrow(/not in the archive/);
  });

  it("drops Whisper's non-speech markers", () => {
    expect(cleanTranscript(" [BLANK_AUDIO] ")).toBe("");
    expect(cleanTranscript("(silence) Run the  tests [Music] again.")).toBe("Run the tests again.");
  });
});
