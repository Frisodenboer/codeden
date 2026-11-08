import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChime, createChimeDebouncer } from "@/lib/attention/chime";
import { createFaviconBadge } from "@/lib/attention/favicon";
import {
  canOfferNotifications,
  markNotificationOfferAnswered,
} from "@/lib/attention/notification-offer";
import { countedTitle, createTitleFlasher, WAITING_TITLE } from "@/lib/attention/title";

// ---------------------------------------------------------------- chime

const param = () => ({
  value: 1,
  setValueAtTime: vi.fn(),
  exponentialRampToValueAtTime: vi.fn(),
});

/** A stand-in AudioContext that records the oscillators the chime starts. */
class FakeAudioContext {
  static created: FakeAudioContext[] = [];
  state: AudioContextState;
  currentTime = 5;
  destination = {};
  oscillators: { frequency: ReturnType<typeof param>; start: ReturnType<typeof vi.fn> }[] = [];
  resume = vi.fn(async () => {
    this.state = "running";
  });

  constructor() {
    this.state = FakeAudioContext.initialState;
    FakeAudioContext.created.push(this);
  }
  static initialState: AudioContextState = "running";

  createGain() {
    return { gain: param(), connect: vi.fn((node: unknown) => node) };
  }
  createOscillator() {
    const osc = {
      type: "",
      frequency: param(),
      connect: vi.fn((node: unknown) => node),
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.oscillators.push(osc);
    return osc;
  }
}

const fakeCtor = () => FakeAudioContext as unknown as new () => AudioContext;

describe("chime", () => {
  beforeEach(() => {
    FakeAudioContext.created = [];
    FakeAudioContext.initialState = "running";
  });

  it("does nothing until audio has been unlocked by a gesture", () => {
    const chime = createChime(fakeCtor);
    expect(() => chime.play()).not.toThrow();
    expect(FakeAudioContext.created).toHaveLength(0);
  });

  it("plays two rising notes once unlocked", () => {
    const chime = createChime(fakeCtor);
    chime.unlock();
    chime.play();
    const ctx = FakeAudioContext.created[0];
    expect(ctx?.oscillators).toHaveLength(2);
    const [first, second] = (ctx?.oscillators ?? []).map(
      (o) => o.frequency.setValueAtTime.mock.calls[0] as [number, number],
    );
    expect(first?.[0]).toBeLessThan(second?.[0] ?? 0);
    expect(first?.[1]).toBeLessThan(second?.[1] ?? 0);
    for (const o of ctx?.oscillators ?? []) expect(o.start).toHaveBeenCalledTimes(1);
  });

  it("unlocks on the first gesture and then stops listening", () => {
    const chime = createChime(fakeCtor);
    const target = new EventTarget();
    const removed = vi.spyOn(target, "removeEventListener");
    chime.installUnlock(target);
    target.dispatchEvent(new Event("keydown"));
    expect(FakeAudioContext.created).toHaveLength(1);
    expect(removed).toHaveBeenCalledTimes(3);
    chime.play();
    expect(FakeAudioContext.created[0]?.oscillators).toHaveLength(2);
  });

  it("resumes a suspended context, but never plays late", async () => {
    FakeAudioContext.initialState = "suspended";
    let clock = 0;
    const chime = createChime(fakeCtor, () => clock);
    chime.unlock();
    const ctx = FakeAudioContext.created[0];
    if (!ctx) throw new Error("no context");
    ctx.state = "suspended";
    chime.play();
    await vi.waitFor(() => expect(ctx.oscillators).toHaveLength(2));

    ctx.state = "suspended";
    let settle: () => void = () => undefined;
    ctx.resume.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          settle = () => {
            ctx.state = "running";
            done();
          };
        }),
    );
    chime.play();
    clock += 5000; // The browser only allowed audio much later.
    settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(ctx.oscillators).toHaveLength(2);
  });

  it("never throws when audio is missing or broken", () => {
    const missing = createChime(() => undefined);
    expect(() => {
      missing.unlock();
      missing.play();
    }).not.toThrow();
    const broken = createChime(
      () =>
        class {
          constructor() {
            throw new Error("no audio device");
          }
        } as unknown as new () => AudioContext,
    );
    expect(() => {
      broken.unlock();
      broken.play();
    }).not.toThrow();
  });

  it("debounces bursts into one chime", () => {
    let clock = 0;
    const play = vi.fn();
    const request = createChimeDebouncer(play, 3000, () => clock);
    expect(request()).toBe(true);
    clock = 1000;
    expect(request()).toBe(false);
    clock = 2999;
    expect(request()).toBe(false);
    clock = 3000;
    expect(request()).toBe(true);
    expect(play).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------- favicon

describe("favicon badge", () => {
  const dataUrl = "data:image/png;base64,QkFER0U=";
  let ctx2d: Record<string, ReturnType<typeof vi.fn> | string>;

  beforeEach(() => {
    document.head.innerHTML = '<link rel="icon" type="image/svg+xml" href="/favicon.svg" />';
    ctx2d = {
      clearRect: vi.fn(),
      drawImage: vi.fn(),
      beginPath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      fillStyle: "",
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ctx2d as unknown as CanvasRenderingContext2D,
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(dataUrl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.head.innerHTML = "";
  });

  const link = () => document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  const image = {} as CanvasImageSource;

  it("draws an amber dot on the favicon and restores the original", async () => {
    const loadImage = vi.fn(async () => image);
    const badge = createFaviconBadge({ loadImage });
    badge.set(true);
    await vi.waitFor(() => expect(link()?.getAttribute("href")).toBe(dataUrl));
    expect(loadImage).toHaveBeenCalledWith("/favicon.svg");
    expect(ctx2d.drawImage).toHaveBeenCalledWith(image, 0, 0, 64, 64);
    expect(ctx2d.fillStyle).toBe("#f59e0b");
    expect(link()?.getAttribute("type")).toBe("image/png");
    expect(link()?.dataset.attention).toBe("waiting");

    badge.set(false);
    expect(link()?.getAttribute("href")).toBe("/favicon.svg");
    expect(link()?.getAttribute("type")).toBe("image/svg+xml");
    expect(link()?.dataset.attention).toBeUndefined();

    // The badged icon is drawn once and reused.
    badge.set(true);
    expect(link()?.getAttribute("href")).toBe(dataUrl);
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it("does not badge if it was turned off while the image loaded", async () => {
    let finish: (img: CanvasImageSource) => void = () => undefined;
    const badge = createFaviconBadge({
      loadImage: () => new Promise((done) => (finish = done)),
    });
    badge.set(true);
    badge.set(false);
    finish(image);
    await new Promise((r) => setTimeout(r, 0));
    expect(link()?.getAttribute("href")).toBe("/favicon.svg");
  });

  it("keeps the original icon when drawing fails", async () => {
    const badge = createFaviconBadge({ loadImage: async () => Promise.reject(new Error("404")) });
    expect(() => badge.set(true)).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(link()?.getAttribute("href")).toBe("/favicon.svg");

    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    const noCanvas = createFaviconBadge({ loadImage: async () => image });
    noCanvas.set(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(link()?.getAttribute("href")).toBe("/favicon.svg");
  });
});

// ---------------------------------------------------------------- title

describe("title flasher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.title = "(2) CodeDen";
  });
  afterEach(() => vi.useRealTimers());

  it("alternates with the waiting title, keeping the count", () => {
    const flasher = createTitleFlasher({ intervalMs: 1500 });
    flasher.update({ count: 2, flashing: true });
    expect(document.title).toBe(`(2) ${WAITING_TITLE}`);
    vi.advanceTimersByTime(1500);
    expect(document.title).toBe("(2) CodeDen");
    vi.advanceTimersByTime(1500);
    expect(document.title).toBe(`(2) ${WAITING_TITLE}`);
    flasher.update({ count: 3, flashing: true });
    expect(document.title).toBe(`(3) ${WAITING_TITLE}`);
  });

  it("restores the usual title when flashing stops and stays still", () => {
    const flasher = createTitleFlasher({ intervalMs: 1500 });
    flasher.update({ count: 1, flashing: true });
    flasher.update({ count: 1, flashing: false });
    expect(document.title).toBe("(1) CodeDen");
    vi.advanceTimersByTime(6000);
    expect(document.title).toBe("(1) CodeDen");
  });

  it("leaves the title alone when it never flashed", () => {
    document.title = "(4) CodeDen";
    const flasher = createTitleFlasher();
    flasher.update({ count: 4, flashing: false });
    flasher.stop();
    expect(document.title).toBe("(4) CodeDen");
  });

  it("drops the count when nothing is open", () => {
    expect(countedTitle(0)).toBe("CodeDen");
    expect(countedTitle(0, WAITING_TITLE)).toBe(WAITING_TITLE);
    expect(countedTitle(5)).toBe("(5) CodeDen");
  });
});

// ---------------------------------------------------------------- notification offer

describe("desktop notification offer", () => {
  const memoryStorage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    };
  };

  it("is made only while the permission is undecided", () => {
    const storage = memoryStorage();
    expect(canOfferNotifications("default", storage)).toBe(true);
    expect(canOfferNotifications("granted", storage)).toBe(false);
    expect(canOfferNotifications("denied", storage)).toBe(false);
    expect(canOfferNotifications("unsupported", storage)).toBe(false);
  });

  it("is never made again once answered", () => {
    const storage = memoryStorage();
    markNotificationOfferAnswered(storage);
    expect(canOfferNotifications("default", storage)).toBe(false);
  });

  it("survives storage that throws", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(canOfferNotifications("default", throwing)).toBe(false);
    expect(() => markNotificationOfferAnswered(throwing)).not.toThrow();
  });
});
