import { describe, expect, it } from "vitest";
import {
  BrowserClientMessage,
  BrowserNavigateRequest,
  BrowserServerMessage,
  BrowserTabsResponse,
  BrowserWsQuery,
  DevServersResponse,
} from "../src";

const roundTrip = <T>(schema: { parse: (v: unknown) => T }, value: T) =>
  expect(schema.parse(JSON.parse(JSON.stringify(value)))).toEqual(value);

const tab = { tabId: "t1", url: "http://localhost:5173/", title: "App", active: true };

describe("browser panel contracts", () => {
  it("round-trips routes and channel messages", () => {
    roundTrip(BrowserNavigateRequest, { url: "localhost:3000", tabId: "t1" });
    roundTrip(BrowserTabsResponse, { open: true, tabs: [tab] });
    roundTrip(DevServersResponse, {
      servers: [{ port: 5173, pid: 42, url: "http://localhost:5173" }],
    });
    roundTrip(BrowserClientMessage, {
      type: "input",
      input: { type: "mouse.down", x: 1, y: 2, frameWidth: 800, frameHeight: 600, button: "left" },
    });
    roundTrip(BrowserClientMessage, { type: "watch", settings: { maxFps: 10 } });
    roundTrip(BrowserServerMessage, {
      type: "state",
      viewerId: "ui-1",
      open: true,
      watching: true,
      tabs: [tab],
    });
    roundTrip(BrowserServerMessage, {
      type: "frame",
      mediaType: "image/jpeg",
      data: "AAAA",
      width: 800,
      height: 600,
      tabId: "t1",
    });
  });

  it("coerces numeric query parameters", () => {
    expect(BrowserWsQuery.parse({ sessionId: "s", open: "1", maxFps: "12" })).toEqual({
      sessionId: "s",
      open: "1",
      maxFps: 12,
    });
    expect(BrowserWsQuery.safeParse({ sessionId: "s", maxFps: "999" }).success).toBe(false);
  });
});
