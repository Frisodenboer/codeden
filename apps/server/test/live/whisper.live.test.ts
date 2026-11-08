/**
 * Real local Whisper test (downloads about 33 MB, no account or cost). Run with
 *   CODEDEN_REAL_WHISPER=1 pnpm --filter @codeden/server exec vitest run test/live/whisper.live.test.ts
 * It downloads the pinned runtime for this platform and a model (`tiny.en` by default, or
 * `CODEDEN_REAL_WHISPER_MODEL`) from their official sources into a temp folder (or
 * `CODEDEN_REAL_WHISPER_DIR` to keep them between runs), checks their checksums, and
 * transcribes `fixtures/whisper-hello.wav`, a 4.7 s clip generated with a speech synthesizer
 * that says "Please run the checkout tests again and open a pull request."
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WhisperModelId } from "@codeden/contracts";
import { afterAll, describe, expect, it } from "vitest";
import { LocalSttService } from "../../src/services/voice/local/local-stt-service";
import { SettingsStore } from "../../src/settings-store";

const REAL = process.env.CODEDEN_REAL_WHISPER === "1";
const MODEL = WhisperModelId.parse(process.env.CODEDEN_REAL_WHISPER_MODEL ?? "tiny.en");

describe.skipIf(!REAL)("real local Whisper", () => {
  const keep = process.env.CODEDEN_REAL_WHISPER_DIR;
  const dir = keep ?? mkdtempSync(join(tmpdir(), "codeden-real-whisper-"));
  const settings = new SettingsStore(join(dir, "settings.json"));
  settings.update({ voice: { dictation: { engine: "local", local: { model: MODEL } } } });
  const svc = new LocalSttService({
    runtimeDir: join(dir, "deps", "whisper"),
    modelsDir: join(dir, "models", "whisper"),
    settings,
    log: (m) => console.log(m),
  });

  afterAll(async () => {
    await svc.stop();
    if (!keep) rmSync(dir, { recursive: true, force: true });
  });

  it(`downloads ${MODEL} and transcribes a short clip`, async () => {
    const downloadStart = performance.now();
    svc.download(MODEL);
    await svc.settled();
    const status = svc.status();
    const model = status.models.find((m) => m.id === MODEL);
    expect(status.runtime.error).toBeNull();
    expect(model?.error ?? null).toBeNull();
    expect(model?.state).toBe("installed");
    console.log(
      `download: ${Math.round(performance.now() - downloadStart)} ms ` +
        `(runtime ${status.runtime.totalBytes} B, model ${model?.totalBytes} B)`,
    );

    const wav = readFileSync(join(import.meta.dirname, "..", "fixtures", "whisper-hello.wav"));
    const first = performance.now();
    const cold = await svc.transcribe(wav);
    const coldMs = Math.round(performance.now() - first);
    const warm = await svc.transcribe(wav);
    console.log(
      `cold (load + transcribe): ${coldMs} ms; warm transcribe: ${warm.elapsedMs} ms; ` +
        `text: ${JSON.stringify(warm.text)}`,
    );
    expect(cold.text.toLowerCase()).toContain("checkout");
    expect(warm.text.toLowerCase()).toMatch(/pull request/);
  }, 600_000);
});
