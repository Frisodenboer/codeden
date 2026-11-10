import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openBrowserSocket } from "@/lib/api/browser-channel";
import { frameRect, mouseInput, onFrame, wheelDeltas } from "@/lib/browser-input";
import { createViewportReporter, panelViewport } from "@/lib/browser-viewport";

const noMods = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

describe("panel geometry", () => {
  const panel = { left: 10, top: 40, width: 460, height: 712 };

  it("fills the panel when the page follows it, and letterboxes a fitted frame", () => {
    expect(frameRect(panel, 920, 1424, "fill")).toEqual(panel);
    // A 1280x800 preset in a 460x712 panel: full width, centred vertically.
    const fitted = frameRect(panel, 1280, 800, "contain");
    expect(fitted.width).toBeCloseTo(460);
    expect(fitted.height).toBeCloseTo(287.5);
    expect(fitted.top).toBeCloseTo(40 + (712 - 287.5) / 2);
    expect(onFrame(fitted, 100, 45)).toBe(false); // on the letterbox
    expect(onFrame(fitted, 100, 400)).toBe(true);
  });

  it("maps clicks exactly at several panel sizes and pixel ratios", () => {
    for (const [width, height, dpr] of [
      [460, 712, 2],
      [1000, 640, 1.25],
      [1280, 800, 1],
      [390, 700, 3],
    ] as const) {
      const rect = { left: 0, top: 0, width, height };
      const box = {
        rect,
        frameWidth: width * dpr,
        frameHeight: height * dpr,
        viewportWidth: width,
        viewportHeight: height,
      };
      // CSS point (123, 45) on the panel is frame pixel (123, 45) x dpr.
      const input = mouseInput("mouse.down", { clientX: 123, clientY: 45, ...noMods }, box);
      expect(input).toMatchObject({
        x: 123 * dpr,
        y: 45 * dpr,
        frameWidth: width * dpr,
        viewportWidth: width,
        viewportHeight: height,
      });
    }
  });

  it("maps into a letterboxed frame", () => {
    const rect = frameRect({ left: 0, top: 0, width: 400, height: 600 }, 800, 600, "contain");
    const box = {
      rect,
      frameWidth: 800,
      frameHeight: 600,
      viewportWidth: 800,
      viewportHeight: 600,
    };
    // The frame is 400x300 at top 150: the panel centre is the frame centre.
    const input = mouseInput("mouse.move", { clientX: 200, clientY: 300, ...noMods }, box);
    expect(input).toMatchObject({ x: 400, y: 300 });
  });

  it("turns wheel deltas into page pixels at the drawn scale", () => {
    const fill = {
      rect: { left: 0, top: 0, width: 460, height: 712 },
      frameWidth: 920,
      frameHeight: 1424,
      viewportWidth: 460,
      viewportHeight: 712,
    };
    // Following the panel: 1:1.
    expect(wheelDeltas({ deltaX: 0, deltaY: 100, deltaMode: 0 }, fill)).toEqual({
      deltaX: 0,
      deltaY: 100,
    });
    // Lines and pages become pixels.
    expect(wheelDeltas({ deltaX: 0, deltaY: 3, deltaMode: 1 }, fill).deltaY).toBe(120);
    expect(wheelDeltas({ deltaX: 0, deltaY: 1, deltaMode: 2 }, fill).deltaY).toBeCloseTo(623);
    // A 1280-wide page drawn 460 wide scrolls faster, so content tracks the gesture.
    const fitted = {
      ...fill,
      rect: frameRect(fill.rect, 1280, 800, "contain"),
      viewportWidth: 1280,
      viewportHeight: 800,
    };
    expect(wheelDeltas({ deltaX: 0, deltaY: 100, deltaMode: 0 }, fitted).deltaY).toBeCloseTo(
      (100 * 1280) / 460,
    );
  });
});

describe("viewport reporter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("rounds panel sizes and pixel ratios", () => {
    expect(panelViewport(460.6, 711.2, 1.2500001)).toEqual({
      width: 461,
      height: 711,
      deviceScaleFactor: 1.25,
    });
    expect(panelViewport(0, 0, 0)).toEqual({ width: 1, height: 1, deviceScaleFactor: 1 });
  });

  it("sends the first size at once, then debounces resizes to the settled size", () => {
    const sent: Array<[number, boolean]> = [];
    const r = createViewportReporter((s, claim) => sent.push([s.width, claim]), {
      debounceMs: 120,
      maxWaitMs: 400,
    });
    r.measure(panelViewport(460, 700, 2));
    expect(sent).toEqual([[460, false]]);
    r.measure(panelViewport(470, 700, 2));
    vi.advanceTimersByTime(60);
    r.measure(panelViewport(480, 700, 2));
    vi.advanceTimersByTime(100);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(30);
    expect(sent).toEqual([
      [460, false],
      [480, false],
    ]);
    // Unchanged sizes are not resent.
    r.measure(panelViewport(480, 700, 2));
    vi.advanceTimersByTime(500);
    expect(sent).toHaveLength(2);
  });

  it("keeps up during a long drag (max wait)", () => {
    const sent: number[] = [];
    const r = createViewportReporter((s) => sent.push(s.width), {
      debounceMs: 120,
      maxWaitMs: 400,
    });
    r.measure(panelViewport(400, 700, 1));
    for (let i = 1; i <= 10; i++) {
      r.measure(panelViewport(400 + i * 10, 700, 1));
      vi.advanceTimersByTime(50);
    }
    // 500ms of continuous dragging sent an intermediate size, not just the first.
    expect(sent.length).toBeGreaterThanOrEqual(2);
    vi.advanceTimersByTime(200);
    expect(sent.at(-1)).toBe(500);
  });

  it("claims with the latest size immediately", () => {
    const sent: Array<[number, boolean]> = [];
    const r = createViewportReporter((s, claim) => sent.push([s.width, claim]));
    r.measure(panelViewport(460, 700, 1));
    r.measure(panelViewport(500, 700, 1));
    r.claim();
    expect(sent).toEqual([
      [460, false],
      [500, true],
    ]);
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(2);
    r.claim(); // a claim is sent even when the size is unchanged
    expect(sent.at(-1)).toEqual([500, true]);
  });
});

class FakeSocket {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: unknown[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

describe("browser channel viewport", () => {
  beforeEach(() => {
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", Object.assign(FakeSocket, { OPEN: 1 }));
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("sends the latest size on open and again (without the claim) after a reconnect", () => {
    const ch = openBrowserSocket("ws://127.0.0.1:1", "s1");
    ch.viewport({ width: 400, height: 700, deviceScaleFactor: 2 });
    ch.viewport({ width: 460, height: 700, deviceScaleFactor: 2 }, true);
    const first = FakeSocket.instances[0];
    if (!first) throw new Error("no socket");
    first.readyState = 1;
    first.onopen?.();
    expect(first.sent).toEqual([
      { type: "viewport", width: 460, height: 700, deviceScaleFactor: 2 },
    ]);
    ch.viewport({ width: 500, height: 700, deviceScaleFactor: 2 }, true);
    expect(first.sent.at(-1)).toEqual({
      type: "viewport",
      width: 500,
      height: 700,
      deviceScaleFactor: 2,
      claim: true,
    });
    first.readyState = 3;
    first.onclose?.();
    vi.advanceTimersByTime(600);
    const second = FakeSocket.instances[1];
    if (!second) throw new Error("no reconnect");
    second.readyState = 1;
    second.onopen?.();
    expect(second.sent).toEqual([
      { type: "viewport", width: 500, height: 700, deviceScaleFactor: 2 },
    ]);
    ch.close();
  });
});
