import type { CDPSession } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deviceMetricsParams,
  devServerUrl,
  fitViewport,
  framePixels,
  InputForwarder,
  keyEventParams,
  mapPoint,
  normalizeUrl,
  VIEWPORT_LIMITS,
  virtualKeyCode,
} from "../src/browser";
import { jpegSize, pngSize } from "../src/browser/images";
import { MAX_WHEEL_DELTA } from "../src/browser/input";
import {
  DEFAULT_SCREENCAST,
  type FrameStream,
  Screencast,
  STILL_FRAME_MS,
} from "../src/browser/screencast";

describe("input mapping", () => {
  const viewport = { width: 1280, height: 800 };

  it("maps displayed-frame coordinates onto the viewport and clamps", () => {
    expect(mapPoint({ x: 320, y: 200, frameWidth: 640, frameHeight: 400 }, viewport)).toEqual({
      x: 640,
      y: 400,
    });
    expect(mapPoint({ x: -5, y: 900, frameWidth: 640, frameHeight: 400 }, viewport)).toEqual({
      x: 0,
      y: 799,
    });
  });

  it("maps exactly at several viewport sizes and device scales", () => {
    // [viewport CSS, device scale]: frames are CSS x scale pixels; the frame centre is the
    // viewport centre and a corner pixel maps to the corner.
    const cases = [
      [{ width: 460, height: 712 }, 2],
      [{ width: 1000, height: 640 }, 1.25],
      [{ width: 1280, height: 800 }, 1],
      [{ width: 390, height: 700 }, 2],
    ] as const;
    for (const [vp, scale] of cases) {
      const frame = { frameWidth: vp.width * scale, frameHeight: vp.height * scale };
      expect(mapPoint({ x: frame.frameWidth / 2, y: frame.frameHeight / 2, ...frame }, vp)).toEqual(
        { x: vp.width / 2, y: vp.height / 2 },
      );
      expect(mapPoint({ x: 10 * scale, y: 20 * scale, ...frame }, vp)).toEqual({ x: 10, y: 20 });
    }
  });

  it("maps against the frame's own viewport while a resize is in flight", () => {
    // The user clicked a 920x1424 frame of a 460x712 page; the page is already 600x712.
    const point = mapPoint(
      {
        x: 460,
        y: 712,
        frameWidth: 920,
        frameHeight: 1424,
        viewportWidth: 460,
        viewportHeight: 712,
      },
      { width: 600, height: 712 },
    );
    expect(point).toEqual({ x: 230, y: 356 });
    // Clamped to the current viewport.
    expect(
      mapPoint(
        {
          x: 920,
          y: 0,
          frameWidth: 920,
          frameHeight: 1424,
          viewportWidth: 460,
          viewportHeight: 712,
        },
        { width: 400, height: 712 },
      ).x,
    ).toBe(399);
  });

  it("caps wheel deltas", () => {
    const input = new InputForwarder();
    const frame = { frameWidth: 100, frameHeight: 100 };
    expect(
      input.mouseEventParams(
        { type: "mouse.wheel", x: 1, y: 1, deltaY: 99_999, ...frame },
        viewport,
      ),
    ).toMatchObject({ deltaY: MAX_WHEEL_DELTA, deltaX: 0 });
  });

  it("tracks held buttons across a drag", () => {
    const input = new InputForwarder();
    const frame = { frameWidth: 1280, frameHeight: 800 };
    const down = input.mouseEventParams(
      { type: "mouse.down", x: 1, y: 2, button: "left", ...frame },
      viewport,
    );
    expect(down).toMatchObject({ type: "mousePressed", button: "left", buttons: 1, clickCount: 1 });
    const move = input.mouseEventParams({ type: "mouse.move", x: 5, y: 5, ...frame }, viewport);
    expect(move).toMatchObject({ type: "mouseMoved", button: "none", buttons: 1 });
    const up = input.mouseEventParams(
      { type: "mouse.up", x: 5, y: 5, button: "left", ...frame },
      viewport,
    );
    expect(up).toMatchObject({ type: "mouseReleased", buttons: 0 });
    const wheel = input.mouseEventParams(
      { type: "mouse.wheel", x: 5, y: 5, deltaY: 120, ...frame },
      viewport,
    );
    expect(wheel).toMatchObject({ type: "mouseWheel", deltaX: 0, deltaY: 120, button: "none" });
  });

  it("builds key events with virtual key codes and text", () => {
    expect(virtualKeyCode("Enter")).toBe(13);
    expect(virtualKeyCode("a")).toBe(65);
    expect(virtualKeyCode("7")).toBe(55);
    expect(virtualKeyCode("Dead")).toBeUndefined();
    expect(keyEventParams({ type: "key.down", key: "a", code: "KeyA" })).toMatchObject({
      type: "keyDown",
      text: "a",
      windowsVirtualKeyCode: 65,
    });
    expect(keyEventParams({ type: "key.down", key: "Enter" })).toMatchObject({
      type: "keyDown",
      text: "\r",
    });
    expect(keyEventParams({ type: "key.down", key: "ArrowLeft" })).toMatchObject({
      type: "rawKeyDown",
      windowsVirtualKeyCode: 37,
    });
    // Ctrl+A is a shortcut, not typing.
    expect(keyEventParams({ type: "key.down", key: "a", modifiers: 2 })).toMatchObject({
      type: "rawKeyDown",
      modifiers: 2,
    });
    expect(keyEventParams({ type: "key.up", key: "a" })).toMatchObject({ type: "keyUp" });
  });
});

describe("urls", () => {
  it("normalizes navigation targets", () => {
    expect(normalizeUrl("localhost:3000")).toBe("http://localhost:3000/");
    expect(normalizeUrl("example.com/x")).toBe("http://example.com/x");
    expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
    expect(normalizeUrl("about:blank")).toBe("about:blank");
    expect(devServerUrl(5173)).toBe("http://localhost:5173/");
    expect(devServerUrl(5173, "app")).toBe("http://localhost:5173/app");
  });

  it("refuses browser-internal and script URLs", () => {
    for (const url of ["edge://settings", "chrome://flags", "javascript:alert(1)", " "]) {
      expect(() => normalizeUrl(url)).toThrow();
    }
  });
});

describe("image headers", () => {
  it("reads PNG and JPEG sizes", () => {
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
    png.write("IHDR", 12, "ascii");
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(pngSize(png)).toEqual({ width: 640, height: 480 });
    expect(pngSize(Buffer.from("nope"))).toBeNull();

    // SOI, APP0 (length 4), SOF0 with height 300 and width 400.
    const jpeg = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c,
      0x01, 0x90, 0x03, 0x00, 0x00, 0x00, 0x00,
    ]);
    expect(jpegSize(jpeg)).toEqual({ width: 400, height: 300 });
    expect(jpegSize(Buffer.from([0x00, 0x01]))).toBeNull();
  });
});

describe("screencast viewers", () => {
  it("counts viewers and only runs with a tab and at least one viewer", async () => {
    const cast = new Screencast("s", () => {});
    expect(await cast.watch("a", true)).toBe(1);
    expect(cast.running).toBe(false); // no tab yet
    expect(await cast.watch("b", true, { maxFps: 30 })).toBe(2);
    expect(await cast.watch("a", false)).toBe(1);
    expect(await cast.watch("b", false)).toBe(0);
    expect(DEFAULT_SCREENCAST.maxFps).toBe(20);
  });

  it("sizes frames to the viewport's device pixels, under any viewer caps", async () => {
    const cast = new Screencast("s", () => {});
    expect(cast.startParams).toMatchObject({ maxWidth: 1280, maxHeight: 800, quality: 75 });
    await cast.setFrameSize(
      framePixels(fitViewport({ width: 460, height: 712, deviceScaleFactor: 2 })),
    );
    expect(cast.startParams).toMatchObject({ maxWidth: 920, maxHeight: 1424 });
    await cast.watch("phone", true, { maxWidth: 600 });
    expect(cast.startParams).toMatchObject({ maxWidth: 600, maxHeight: 1424 });
  });
});

/** A CDP session for a still page: the screencast never sends a frame on its own. */
function stillPageCdp() {
  // SOI, APP0, SOF0 460x712.
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0xc8, 0x01,
    0xcc, 0x03, 0x00, 0x00, 0x00, 0x00,
  ]).toString("base64");
  const listeners = new Map<string, (e: unknown) => void>();
  const sent: string[] = [];
  const cdp = {
    on: (event: string, l: (e: unknown) => void) => listeners.set(event, l),
    off: (event: string) => listeners.delete(event),
    send: async (method: string) => {
      sent.push(method);
      if (method === "Page.captureScreenshot") return { data: jpeg };
      if (method === "Page.getLayoutMetrics") return { cssVisualViewport: { pageX: 0, pageY: 40 } };
      return {};
    },
  };
  const frame = (sessionId: number) =>
    listeners.get("Page.screencastFrame")?.({
      data: jpeg,
      sessionId,
      metadata: {
        deviceWidth: 460,
        deviceHeight: 712,
        pageScaleFactor: 1,
        offsetTop: 0,
        scrollOffsetX: 0,
        scrollOffsetY: 0,
      },
    });
  return { cdp: cdp as unknown as CDPSession, sent, frame };
}

describe("screencast still frames", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("captures a still when a started screencast sends nothing", async () => {
    const emitted: FrameStream[] = [];
    const cast = new Screencast("s", (f) => emitted.push(f));
    const page = stillPageCdp();
    await cast.setFrameSize({ width: 920, height: 1424 }, { width: 460, height: 712 });
    await cast.setTab({ tabId: "t1", cdp: page.cdp });
    await cast.watch("panel", true);
    expect(emitted).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(STILL_FRAME_MS + 10);
    expect(page.sent).toContain("Page.captureScreenshot");
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      tabId: "t1",
      width: 460,
      height: 712,
      metadata: { deviceWidth: 460, deviceHeight: 712, scrollOffsetY: 40 },
    });
    // A later viewer gets that picture straight away.
    await cast.watch("phone", true);
    expect(emitted).toHaveLength(2);
  });

  it("doesn't capture when Chromium sent a frame, and stops cleanly", async () => {
    const emitted: FrameStream[] = [];
    const cast = new Screencast("s", (f) => emitted.push(f));
    const page = stillPageCdp();
    await cast.setTab({ tabId: "t1", cdp: page.cdp });
    await cast.watch("panel", true);
    page.frame(1);
    await vi.advanceTimersByTimeAsync(STILL_FRAME_MS + 10);
    expect(page.sent).not.toContain("Page.captureScreenshot");
    expect(emitted).toHaveLength(1);
    // Stopping sends the held-back ack before stopping the screencast.
    await cast.watch("panel", false);
    expect(page.sent.slice(-2)).toEqual(["Page.screencastFrameAck", "Page.stopScreencast"]);
  });
});

describe("viewport sizing", () => {
  it("passes ordinary panel sizes through and rounds", () => {
    expect(fitViewport({ width: 460.4, height: 711.6, deviceScaleFactor: 2 })).toEqual({
      width: 460,
      height: 712,
      deviceScaleFactor: 2,
    });
    expect(fitViewport({ width: 1000, height: 640, deviceScaleFactor: 1.25 })).toEqual({
      width: 1000,
      height: 640,
      deviceScaleFactor: 1.25,
    });
    expect(fitViewport({ width: 800, height: 600 }).deviceScaleFactor).toBe(1);
  });

  it("clamps size and scale", () => {
    expect(fitViewport({ width: 100, height: 50, deviceScaleFactor: 0.5 })).toEqual({
      width: VIEWPORT_LIMITS.minWidth,
      height: VIEWPORT_LIMITS.minHeight,
      deviceScaleFactor: 1,
    });
    expect(fitViewport({ width: 9000, height: 9000 })).toMatchObject({
      width: VIEWPORT_LIMITS.maxWidth,
      height: VIEWPORT_LIMITS.maxHeight,
    });
    // A 3x phone renders at 2x.
    expect(fitViewport({ width: 390, height: 700, deviceScaleFactor: 3 }).deviceScaleFactor).toBe(
      2,
    );
  });

  it("lowers the scale (never below 1) to keep frames within the pixel budget", () => {
    const wide = fitViewport({ width: 1600, height: 1000, deviceScaleFactor: 2 });
    expect(wide.deviceScaleFactor).toBeGreaterThan(1);
    expect(wide.deviceScaleFactor).toBeLessThan(2);
    const px = framePixels(wide);
    expect(px.width * px.height).toBeLessThanOrEqual(VIEWPORT_LIMITS.maxFramePixels);
    // Even 1x is over budget: the frame is scaled down, keeping the aspect.
    const huge = fitViewport({ width: 3840, height: 2400, deviceScaleFactor: 2 });
    expect(huge.deviceScaleFactor).toBe(1);
    const frame = framePixels(huge);
    expect(frame.width / frame.height).toBeCloseTo(3840 / 2400, 2);
    expect(frame.width * frame.height).toBeLessThanOrEqual(VIEWPORT_LIMITS.maxFramePixels);
  });

  it("emulates without mobile mode and with a matching screen", () => {
    expect(deviceMetricsParams({ width: 460, height: 712, deviceScaleFactor: 2 })).toEqual({
      width: 460,
      height: 712,
      deviceScaleFactor: 2,
      mobile: false,
      screenWidth: 460,
      screenHeight: 712,
    });
  });
});
