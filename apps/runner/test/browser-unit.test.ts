import { describe, expect, it } from "vitest";
import {
  devServerUrl,
  InputForwarder,
  keyEventParams,
  mapPoint,
  normalizeUrl,
  virtualKeyCode,
} from "../src/browser";
import { jpegSize, pngSize } from "../src/browser/images";
import { DEFAULT_SCREENCAST, Screencast } from "../src/browser/screencast";

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
    expect(DEFAULT_SCREENCAST.maxFps).toBe(15);
  });
});
