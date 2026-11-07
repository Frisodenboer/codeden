import type { BrowserServerMessage, BrowserTab } from "@codeden/contracts";
import type { WSContext } from "hono/ws";
import { describe, expect, it } from "vitest";
import { BrowserBridge } from "../src/realtime/browser";
import type { BrowserService } from "../src/services/browser/browser-service";

const tab: BrowserTab = { tabId: "t1", url: "http://localhost:3000/", title: "App", active: true };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A bridge over a fake runner browser, with one connected viewer. */
async function setup() {
  const commands: Array<{ name: string; watching?: boolean }> = [];
  let open = true;
  const browser = {
    tabs: async () => ({ open, tabs: open ? [tab] : [] }),
    open: async () => {
      open = true;
      return { tabs: [tab] };
    },
    command: async (cmd: { name: string; watching?: boolean }) => {
      commands.push(cmd);
      return {};
    },
  } as unknown as BrowserService;
  const messages: BrowserServerMessage[] = [];
  const ws = {
    readyState: 1,
    raw: {},
    send: (data: string) => messages.push(JSON.parse(data) as BrowserServerMessage),
  } as unknown as WSContext;
  const bridge = new BrowserBridge({ browser });
  const events = bridge.handlers({ sessionId: "s1" });
  events.onOpen?.(new Event("open"), ws);
  await tick();
  await tick();
  return { bridge, messages, commands, setOpen: (v: boolean) => (open = v) };
}

describe("BrowserBridge", () => {
  it("detaches viewers with a closed state when the browser closes, and re-attaches on open", async () => {
    const { bridge, messages, commands, setOpen } = await setup();
    expect(messages.at(-1)).toMatchObject({ type: "state", open: true, watching: true });
    expect(commands.filter((c) => c.name === "browser.screencast")).toHaveLength(1);

    setOpen(false);
    bridge.onStream({ kind: "browser.tabs", sessionId: "s1", tabs: [] });
    expect(messages.at(-1)).toEqual({
      type: "state",
      viewerId: expect.any(String),
      open: false,
      watching: false,
      tabs: [],
    });
    // Detached: no frames reach it while closed.
    const before = messages.length;
    bridge.onStream({
      kind: "browser.frame",
      sessionId: "s1",
      mediaType: "image/jpeg",
      data: "AA==",
      width: 10,
      height: 10,
    });
    expect(messages.length).toBe(before);
    expect(bridge.viewerCount("s1")).toBe(1);

    setOpen(true);
    bridge.onStream({ kind: "browser.tabs", sessionId: "s1", tabs: [tab] });
    await tick();
    expect(commands.filter((c) => c.name === "browser.screencast" && c.watching)).toHaveLength(2);
    expect(messages.at(-1)).toMatchObject({ type: "state", open: true, watching: true });
  });
});
