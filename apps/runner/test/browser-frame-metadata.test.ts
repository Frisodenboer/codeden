import type { BrowserFrameMetadata } from "@codeden/contracts";
import type { CDPSession } from "playwright-core";
import { describe, expect, it } from "vitest";
import { mapPoint } from "../src/browser";
import { normalizeFrameMetadata } from "../src/browser/frame-metadata";
import { type FrameStream, Screencast } from "../src/browser/screencast";

const meta = (deviceWidth: number, deviceHeight: number): BrowserFrameMetadata => ({
  deviceWidth,
  deviceHeight,
  pageScaleFactor: 1,
  offsetTop: 0,
  scrollOffsetX: 0,
  scrollOffsetY: 120,
});

/** A minimal JPEG (SOI, APP0, SOF0) of the given size: enough for `jpegSize`. */
function jpeg(width: number, height: number): string {
  return Buffer.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0x00,
    0x00,
    0x00,
    0x00,
  ]).toString("base64");
}

describe("frame metadata on macOS (scaled frames report scaled DIPs)", () => {
  // Measured on macOS CI: a 1280x800 page screencast with maxWidth 640 / maxHeight 400 sends
  // 640x400 frames whose metadata says 640x400; Windows and Linux say 1280x800.
  const page = { width: 1280, height: 800, deviceScaleFactor: 1 };
  const cap = { width: 640, height: 400 };

  it("rewrites the macOS shape of a capped frame to the page viewport", () => {
    expect(normalizeFrameMetadata(meta(640, 400), { width: 640, height: 400 }, page, cap)).toEqual({
      ...meta(1280, 800),
      scrollOffsetY: 120,
    });
    // At 2x: a 1280x800 page at 2x capped to 1280x800 pixels reports 640x400 on macOS.
    expect(
      normalizeFrameMetadata(
        meta(640, 400),
        { width: 1280, height: 800 },
        { ...page, deviceScaleFactor: 2 },
        { width: 1280, height: 800 },
      ),
    ).toMatchObject({ deviceWidth: 1280, deviceHeight: 800 });
    // The pixel budget scales a huge panel's frames down too.
    expect(
      normalizeFrameMetadata(
        meta(2560, 1600),
        { width: 2560, height: 1600 },
        { width: 3840, height: 2400, deviceScaleFactor: 1 },
        { width: 2560, height: 1600 },
      ),
    ).toMatchObject({ deviceWidth: 3840, deviceHeight: 2400 });
  });

  it("leaves metadata that already describes the page alone", () => {
    // Windows and Linux, capped frame.
    const windows = meta(1280, 800);
    expect(normalizeFrameMetadata(windows, { width: 640, height: 400 }, page, cap)).toBe(windows);
    // Frames at the viewport's device pixels (the normal case): every platform agrees.
    const hidpi = meta(460, 712);
    expect(
      normalizeFrameMetadata(
        hidpi,
        { width: 920, height: 1424 },
        { width: 460, height: 712, deviceScaleFactor: 2 },
        { width: 920, height: 1424 },
      ),
    ).toBe(hidpi);
    // A frame of a newer, smaller layout arriving before the screencast restarts.
    const newer = meta(400, 712);
    expect(
      normalizeFrameMetadata(
        newer,
        { width: 800, height: 1424 },
        { width: 460, height: 712, deviceScaleFactor: 2 },
        { width: 920, height: 1424 },
      ),
    ).toBe(newer);
  });

  it("emits normalized frames, so panel clicks map onto the full-size page", async () => {
    const emitted: FrameStream[] = [];
    const cast = new Screencast("s", (f) => emitted.push(f));
    let onFrame: ((e: unknown) => void) | undefined;
    const cdp = {
      on: (_event: string, l: (e: unknown) => void) => {
        onFrame = l;
      },
      off: () => {},
      send: async () => ({}),
    } as unknown as CDPSession;
    await cast.setFrameSize({ width: 1280, height: 800 }, page);
    await cast.setTab({ tabId: "t1", cdp });
    await cast.watch("phone", true, { maxWidth: 640, maxHeight: 400 });
    // What Chromium sends on macOS for this screencast.
    onFrame?.({ data: jpeg(640, 400), sessionId: 1, metadata: meta(640, 400) });
    const frame = emitted.at(-1);
    expect(frame).toMatchObject({
      width: 640,
      height: 400,
      metadata: { deviceWidth: 1280, deviceHeight: 800 },
    });
    // The panel sends the frame's metadata back with a click in frame pixels: (100, 75) on
    // the 640x400 frame is (200, 150) on the 1280x800 page (it was (100, 75) before the fix).
    const input = {
      x: 100,
      y: 75,
      frameWidth: 640,
      frameHeight: 400,
      viewportWidth: frame?.metadata?.deviceWidth,
      viewportHeight: frame?.metadata?.deviceHeight,
    };
    expect(mapPoint(input, page)).toEqual({ x: 200, y: 150 });
    await cast.dispose();
  });
});
