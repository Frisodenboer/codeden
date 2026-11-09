import { Settings } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { type SpeechItem, SpeechQueue } from "@/lib/voice/speech-queue";
import { shouldReadAloud } from "@/lib/voice/speech-text";

/** A fake player: each item "plays" until the test ends it or the queue stops it. */
function harness(maxPending?: number) {
  const log: string[] = [];
  const endings = new Map<string, () => void>();
  let stopCurrent: (() => void) | null = null;
  const queue = new SpeechQueue({
    stopAudio: () => stopCurrent?.(),
    maxPending,
  });
  const item = (key: string, allowed?: () => boolean): SpeechItem => ({
    key,
    allowed,
    play: () =>
      new Promise<void>((resolve) => {
        log.push(`start ${key}`);
        const end = (why: string) => {
          log.push(`${why} ${key}`);
          stopCurrent = null;
          resolve();
        };
        endings.set(key, () => end("end"));
        stopCurrent = () => end("stop");
      }),
  });
  const finish = async (key: string) => {
    endings.get(key)?.();
    await flush();
  };
  return { queue, item, log, finish };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("SpeechQueue", () => {
  it("plays messages in order, each to the end, without interrupting", async () => {
    const { queue, item, log, finish } = harness();
    queue.enqueue(item("a"));
    queue.enqueue(item("b"));
    queue.enqueue(item("c"));
    await flush();
    expect(log).toEqual(["start a"]);
    expect(queue.waiting()).toEqual(["b", "c"]);
    await finish("a");
    await finish("b");
    await finish("c");
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(queue.playing).toBeNull();
  });

  it("never queues the same turn twice", async () => {
    const { queue, item, log, finish } = harness();
    expect(queue.enqueue(item("a"))).toBe(true);
    expect(queue.enqueue(item("a"))).toBe(false);
    await finish("a");
    expect(queue.enqueue(item("a"))).toBe(false);
    expect(queue.has("a")).toBe(true);
    expect(log).toEqual(["start a", "end a"]);
  });

  it("keeps at most three waiting, dropping the oldest", async () => {
    const { queue, item } = harness();
    for (const key of ["a", "b", "c", "d", "e", "f"]) queue.enqueue(item(key));
    await flush();
    expect(queue.playing).toBe("a");
    expect(queue.waiting()).toEqual(["d", "e", "f"]);
  });

  it("skips items that are no longer allowed when their turn comes", async () => {
    const { queue, item, log, finish } = harness();
    const muted = new Set<string>();
    let now = new Date(2026, 10, 9, 21, 59);
    const settings = Settings.parse({
      voice: { readAloud: { enabled: true, quietHours: { start: "22:00", end: "07:00" } } },
    });
    const allowed = (session: string) => () =>
      shouldReadAloud(settings, { now, focused: false, sessionMuted: muted.has(session) });
    queue.enqueue(item("a", allowed("s1")));
    queue.enqueue(item("b", allowed("s2")));
    queue.enqueue(item("c", allowed("s3")));
    await flush();
    muted.add("s2");
    await finish("a");
    expect(log).toEqual(["start a", "end a", "start c"]);
    queue.enqueue(item("d", allowed("s1")));
    now = new Date(2026, 10, 9, 22, 30);
    await finish("c");
    expect(log).toEqual(["start a", "end a", "start c", "end c"]);
    expect(queue.playing).toBeNull();
  });

  it("stops the current item when its session is muted mid-message", async () => {
    const { queue, item, log } = harness();
    let muted = false;
    queue.enqueue(item("a", () => !muted));
    queue.enqueue(item("b"));
    await flush();
    queue.recheck();
    expect(log).toEqual(["start a"]);
    muted = true;
    queue.recheck();
    await flush();
    expect(log).toEqual(["start a", "stop a", "start b"]);
  });

  it("plays the settings test straight away, then carries on with the queue", async () => {
    const { queue, item, log, finish } = harness();
    queue.enqueue(item("a"));
    queue.enqueue(item("b"));
    await flush();
    queue.playNow(item("test"));
    await flush();
    expect(log).toEqual(["start a", "stop a", "start test"]);
    await finish("test");
    expect(log.at(-1)).toBe("start b");
  });

  it("clear stops the current message and drops the rest", async () => {
    const { queue, item, log } = harness();
    queue.enqueue(item("a"));
    queue.enqueue(item("b"));
    await flush();
    queue.clear();
    await flush();
    expect(log).toEqual(["start a", "stop a"]);
    expect(queue.waiting()).toEqual([]);
    expect(queue.playing).toBeNull();
  });

  it("aborts an item that is still preparing when it is stopped", async () => {
    const queue = new SpeechQueue({ stopAudio: () => undefined });
    let aborted = false;
    let release: () => void = () => undefined;
    queue.enqueue({
      key: "a",
      play: (signal) =>
        new Promise<void>((resolve) => {
          release = resolve;
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }),
    });
    await flush();
    queue.clear();
    expect(aborted).toBe(true);
    release();
  });
});
