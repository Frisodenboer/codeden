import { describe, expect, it } from "vitest";
import { BrowserInput, RunnerCommand, RunnerCommandResults, RunnerStream } from "../src";

function roundTrip<T>(schema: { parse: (v: unknown) => T }, value: unknown): T {
  const first = schema.parse(value);
  expect(schema.parse(JSON.parse(JSON.stringify(first)))).toEqual(first);
  return first;
}

describe("browser protocol", () => {
  it("round-trips browser commands", () => {
    const commands: unknown[] = [
      { name: "browser.open", sessionId: "s1", url: "http://localhost:5173" },
      { name: "browser.navigate", sessionId: "s1", tabId: "t2", url: "localhost:3000" },
      { name: "browser.history", sessionId: "s1", action: "back" },
      { name: "browser.tabs.list", sessionId: "s1" },
      { name: "browser.tabs.open", sessionId: "s1" },
      { name: "browser.tabs.close", sessionId: "s1", tabId: "t1" },
      { name: "browser.tabs.activate", sessionId: "s1", tabId: "t1" },
      { name: "browser.viewport", sessionId: "s1", width: 1280, height: 800 },
      {
        name: "browser.screencast",
        sessionId: "s1",
        viewerId: "panel-1",
        watching: true,
        quality: 70,
        maxFps: 20,
      },
      { name: "browser.devServer", sessionId: "s1", port: 5173, path: "/app" },
      { name: "browser.snapshot", sessionId: "s1" },
      { name: "browser.click", sessionId: "s1", ref: "e12", doubleClick: true },
      { name: "browser.type", sessionId: "s1", ref: "f1e3", text: "hi", submit: true },
      { name: "browser.press", sessionId: "s1", key: "Control+A" },
      { name: "browser.screenshot", sessionId: "s1", path: "/tmp/a.png", fullPage: true },
      { name: "browser.logs", sessionId: "s1", kind: "network", since: 10, limit: 50 },
      { name: "browser.evaluate", sessionId: "s1", expression: "() => document.title" },
      { name: "browser.wait", sessionId: "s1", text: "Ready", timeoutMs: 1000 },
      { name: "browser.close", sessionId: "s1" },
    ];
    for (const command of commands) roundTrip(RunnerCommand, command);
    expect(() =>
      RunnerCommand.parse({ name: "browser.click", sessionId: "s1", ref: "button" }),
    ).toThrow();
  });

  it("round-trips forwarded input", () => {
    roundTrip(RunnerCommand, {
      name: "browser.input",
      sessionId: "s1",
      input: {
        type: "mouse.down",
        x: 10,
        y: 20,
        frameWidth: 640,
        frameHeight: 400,
        button: "left",
        clickCount: 1,
        modifiers: 8,
      },
    });
    roundTrip(BrowserInput, { type: "key.down", key: "a", code: "KeyA", text: "a" });
    roundTrip(BrowserInput, { type: "text.insert", text: "hello" });
    expect(() => BrowserInput.parse({ type: "mouse.move", x: 1, y: 1 })).toThrow();
  });

  it("round-trips results and stream data", () => {
    const tab = { tabId: "t1", url: "about:blank", title: "", active: true };
    roundTrip(RunnerCommandResults["browser.open"], { cdpUrl: "ws://127.0.0.1:1/x", tabs: [tab] });
    roundTrip(RunnerCommandResults["browser.open"], { cdpUrl: null });
    roundTrip(RunnerCommandResults["browser.logs"], {
      console: [{ id: 1, tabId: "t1", level: "log", text: "hi", ts: "2026-01-01T00:00:00Z" }],
      network: [
        {
          id: 2,
          tabId: "t1",
          method: "GET",
          url: "http://x/",
          resourceType: "document",
          status: 200,
          failure: null,
          ts: "2026-01-01T00:00:00Z",
          durationMs: 12,
        },
      ],
    });
    roundTrip(RunnerStream, {
      kind: "browser.frame",
      sessionId: "s1",
      tabId: "t1",
      mediaType: "image/jpeg",
      data: "AAAA",
      width: 640,
      height: 400,
      metadata: {
        timestamp: 1,
        deviceWidth: 1280,
        deviceHeight: 800,
        pageScaleFactor: 1,
        offsetTop: 0,
        scrollOffsetX: 0,
        scrollOffsetY: 0,
      },
    });
    // Frames without the new optional fields stay valid.
    roundTrip(RunnerStream, {
      kind: "browser.frame",
      sessionId: "s1",
      mediaType: "image/png",
      data: "AAAA",
      width: 1,
      height: 1,
    });
    roundTrip(RunnerStream, { kind: "browser.tabs", sessionId: "s1", tabs: [tab] });
  });
});
