import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BROWSER_RELAY_SECRET_HEADER } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { toViewRect } from "../src/main/browser/bounds";
import { contextMenuTemplate, type MenuParams } from "../src/main/browser/context-menu";
import { toHandoffCookies, toHandoffTabs } from "../src/main/browser/handoff";
import { type KeyInput, routeKey } from "../src/main/browser/keys";
import {
  allowViewPermission,
  browserUserAgent,
  partitionName,
  uniquePath,
} from "../src/main/browser/policy";
import type { CdpRelay } from "../src/main/browser/relay";
import { acceptRelayRequest } from "../src/main/browser/relay-server";
import { isAllowedBrowserUrl, isExternalOnlyUrl } from "../src/main/browser/urls";

describe("native view bounds", () => {
  const content = { width: 1600, height: 1000 };

  it("places the view over the panel's CSS box at 100% zoom", () => {
    expect(toViewRect({ x: 1100, y: 82, width: 500, height: 918 }, 1, content)).toEqual({
      x: 1100,
      y: 82,
      width: 500,
      height: 918,
    });
  });

  it("scales by the window zoom and rounds each edge so neighbours stay flush", () => {
    // 125%: 880.4 -> 880.5 CSS px edges land on whole DIPs.
    expect(toViewRect({ x: 880.4, y: 65.6, width: 399.6, height: 734.4 }, 1.25, content)).toEqual({
      x: 1101,
      y: 82,
      width: 499,
      height: 918,
    });
    expect(toViewRect({ x: 1000, y: 100, width: 400, height: 400 }, 0.5, content)).toEqual({
      x: 500,
      y: 50,
      width: 200,
      height: 200,
    });
  });

  it("clips to the window and hides what is left empty", () => {
    expect(toViewRect({ x: 1400, y: 900, width: 400, height: 400 }, 1, content)).toEqual({
      x: 1400,
      y: 900,
      width: 200,
      height: 100,
    });
    expect(toViewRect({ x: 1700, y: 0, width: 400, height: 400 }, 1, content)).toBeNull();
    expect(toViewRect({ x: 10, y: 10, width: 0, height: 400 }, 1, content)).toBeNull();
    // A bogus zoom never makes the rectangle disappear.
    expect(toViewRect({ x: 0, y: 0, width: 10, height: 10 }, 0, content)?.width).toBe(10);
  });
});

describe("keys pressed inside a native view", () => {
  const key = (k: Partial<KeyInput>): KeyInput => ({
    type: "keyDown",
    key: "a",
    code: "KeyA",
    control: false,
    meta: false,
    alt: false,
    shift: false,
    ...k,
  });

  it("hands CodeDen's own shortcuts to the UI", () => {
    const palette = routeKey(key({ key: "k", code: "KeyK", control: true }), "win32");
    expect(palette).toEqual({
      kind: "app",
      shortcut: {
        key: "k",
        code: "KeyK",
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      },
    });
    expect(routeKey(key({ key: "k", code: "KeyK", meta: true }), "darwin")?.kind).toBe("app");
    expect(
      routeKey(key({ key: "L", code: "KeyL", control: true, shift: true }), "linux")?.kind,
    ).toBe("app");
    // macOS turns Alt+1 into "¡": the physical key decides.
    expect(routeKey(key({ key: "¡", code: "Digit1", alt: true }), "darwin")?.kind).toBe("app");
    expect(routeKey(key({ key: "\\", code: "Backslash", control: true }), "win32")?.kind).toBe(
      "app",
    );
  });

  it("leaves typing and editing combos in the page", () => {
    for (const k of [
      key({ key: "k", code: "KeyK" }),
      key({ key: "c", code: "KeyC", control: true }),
      key({ key: "v", code: "KeyV", control: true }),
      key({ key: "a", code: "KeyA", control: true }),
      key({ key: "/", code: "Slash" }),
      key({ key: "Enter", code: "Enter" }),
      // AltGr on Windows is Ctrl+Alt: characters typed with it stay in the page.
      key({ key: "\\", code: "Minus", control: true, alt: true }),
      // Cmd+K on Windows is not CodeDen's palette.
      key({ key: "k", code: "KeyK", meta: true }),
      key({ type: "keyUp", key: "k", code: "KeyK", control: true }),
    ]) {
      expect(routeKey(k, "win32")).toBeNull();
    }
  });

  it("runs the usual browser keys on the view", () => {
    const action = (k: Partial<KeyInput>, platform: NodeJS.Platform = "win32") => {
      const r = routeKey(key(k), platform);
      return r?.kind === "browser" ? r.action : null;
    };
    expect(action({ key: "F5", code: "F5" })).toBe("reload");
    expect(action({ key: "r", code: "KeyR", control: true })).toBe("reload");
    expect(action({ key: "R", code: "KeyR", control: true, shift: true })).toBe("hardReload");
    expect(action({ key: "ArrowLeft", code: "ArrowLeft", alt: true })).toBe("back");
    expect(action({ key: "ArrowRight", code: "ArrowRight", alt: true })).toBe("forward");
    expect(action({ key: "[", code: "BracketLeft", meta: true }, "darwin")).toBe("back");
    expect(action({ key: "F12", code: "F12" })).toBe("inspect");
    expect(action({ key: "I", code: "KeyI", control: true, shift: true })).toBe("inspect");
    expect(action({ key: "i", code: "KeyI", meta: true, alt: true, shift: true }, "darwin")).toBe(
      "inspect",
    );
  });
});

describe("the native view's context menu", () => {
  const params = (p: Partial<MenuParams>): MenuParams => ({
    linkURL: "",
    srcURL: "",
    mediaType: "none",
    selectionText: "",
    isEditable: false,
    editFlags: {
      canUndo: false,
      canRedo: false,
      canCut: false,
      canCopy: false,
      canPaste: true,
      canSelectAll: true,
    },
    ...p,
  });
  const calls: string[] = [];
  const actions = {
    canGoBack: true,
    canGoForward: false,
    back: () => calls.push("back"),
    forward: () => calls.push("forward"),
    reload: () => calls.push("reload"),
    openInNewTab: (url: string) => calls.push(`tab ${url}`),
    copyText: (text: string) => calls.push(`copy ${text}`),
    inspect: (x: number, y: number) => calls.push(`inspect ${x},${y}`),
  };
  const labels = (items: ReturnType<typeof contextMenuTemplate>) =>
    items.map((i) => i.label ?? i.role ?? i.type);

  it("offers link actions, navigation and Inspect", () => {
    const items = contextMenuTemplate(
      params({ linkURL: "https://example.com/" }),
      { x: 5, y: 6 },
      actions,
    );
    expect(labels(items)).toEqual([
      "Open link in new tab",
      "Copy link address",
      "separator",
      "Back",
      "Forward",
      "Reload",
      "separator",
      "Inspect",
    ]);
    expect(items.find((i) => i.label === "Forward")?.enabled).toBe(false);
    for (const item of items) (item.click as (() => void) | undefined)?.();
    expect(calls).toEqual([
      "tab https://example.com/",
      "copy https://example.com/",
      "back",
      "forward",
      "reload",
      "inspect 5,6",
    ]);
  });

  it("offers editing in text fields and Copy for a selection; never javascript: links", () => {
    expect(
      labels(contextMenuTemplate(params({ isEditable: true }), { x: 0, y: 0 }, actions)),
    ).toEqual(expect.arrayContaining(["cut", "copy", "paste", "selectAll"]));
    expect(
      labels(contextMenuTemplate(params({ selectionText: "hi" }), { x: 0, y: 0 }, actions))[0],
    ).toBe("copy");
    expect(
      labels(
        contextMenuTemplate(params({ linkURL: "javascript:alert(1)" }), { x: 0, y: 0 }, actions),
      ),
    ).not.toContain("Open link in new tab");
  });
});

describe("hand-off to the runner's Chromium", () => {
  it("converts partition cookies to CDP cookies", () => {
    expect(
      toHandoffCookies([
        {
          name: "sid",
          value: "abc",
          domain: "localhost",
          hostOnly: true,
          path: "/",
          httpOnly: true,
          secure: false,
          session: true,
          sameSite: "lax",
        },
        {
          name: "keep",
          value: "1",
          domain: ".example.com",
          hostOnly: false,
          path: "/app",
          secure: true,
          expirationDate: 1_900_000_000.5,
          sameSite: "no_restriction",
        },
        { name: "odd", value: "x", domain: "", path: "/" },
        { name: "unspecified", value: "y", domain: "example.org", sameSite: "unspecified" },
      ]),
    ).toEqual([
      {
        name: "sid",
        value: "abc",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
      {
        name: "keep",
        value: "1",
        domain: ".example.com",
        path: "/app",
        expires: 1_900_000_000.5,
        httpOnly: false,
        secure: true,
        sameSite: "None",
      },
      {
        name: "unspecified",
        value: "y",
        domain: ".example.org",
        path: "/",
        httpOnly: false,
        secure: false,
      },
    ]);
  });

  it("reopens web pages and blanks what can't be reopened", () => {
    expect(
      toHandoffTabs([
        { url: "http://localhost:5173/app", active: false },
        { url: "blob:http://localhost:5173/abc", active: true },
        { url: "", active: false },
        { url: "data:text/html,<h1>hi</h1>", active: false },
        { url: "chrome://settings", active: false },
      ]),
    ).toEqual([
      { url: "http://localhost:5173/app", active: false },
      { url: "about:blank", active: true },
      { url: "about:blank", active: false },
      { url: "data:text/html,<h1>hi</h1>", active: false },
      { url: "about:blank", active: false },
    ]);
  });
});

describe("what native views may do", () => {
  it("allows the web, about:blank and data/blob documents; nothing local or internal", () => {
    for (const ok of [
      "http://localhost:5173/",
      "https://example.com/a?b",
      "about:blank",
      "data:text/html,hi",
      "blob:http://localhost/abc",
    ]) {
      expect(isAllowedBrowserUrl(ok)).toBe(true);
    }
    for (const bad of [
      "file:///etc/passwd",
      "chrome://settings",
      "edge://flags",
      "devtools://devtools/bundled/inspector.html",
      "javascript:alert(1)",
      "about:config",
      "view-source:http://x",
      "not a url",
    ]) {
      expect(isAllowedBrowserUrl(bad)).toBe(false);
    }
    expect(isExternalOnlyUrl("mailto:me@example.com")).toBe(true);
    expect(isExternalOnlyUrl("https://example.com")).toBe(false);
  });

  it("grants only clipboard writes", () => {
    expect(allowViewPermission("clipboard-sanitized-write")).toBe(true);
    for (const p of [
      "media",
      "geolocation",
      "notifications",
      "fullscreen",
      "hid",
      "openExternal",
    ]) {
      expect(allowViewPermission(p)).toBe(false);
    }
  });

  it("looks like Chrome, keeps sessions apart and never overwrites downloads", () => {
    expect(
      browserUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) codeden/0.5.0 Chrome/156.0.0.0 Electron/45.2.3 Safari/537.36",
      ),
    ).toBe(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36",
    );
    expect(partitionName("s1")).toBe("codeden-browser:s1");
    expect(partitionName("s1")).not.toMatch(/^persist:/);
    const dir = mkdtempSync(join(tmpdir(), "codeden-dl-"));
    try {
      expect(uniquePath(dir, "report.pdf")).toBe(join(dir, "report.pdf"));
      writeFileSync(join(dir, "report.pdf"), "");
      writeFileSync(join(dir, "report (1).pdf"), "");
      expect(uniquePath(dir, "report.pdf")).toBe(join(dir, "report (2).pdf"));
      expect(uniquePath(dir, "../../evil.sh")).toBe(join(dir, "evil.sh"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("relay connections", () => {
  const relay = {} as CdpRelay;
  const lookup = (id: string) => (id === "s1" ? { relay, secret: "s".repeat(64) } : null);
  const req = (over: { url?: string; headers?: Record<string, string>; address?: string }) => ({
    url: over.url ?? "/cdp/s1",
    headers: { [BROWSER_RELAY_SECRET_HEADER]: "s".repeat(64), ...over.headers },
    socket: { remoteAddress: over.address ?? "127.0.0.1" },
  });

  it("accept the runner: right path, secret, loopback, no Origin", () => {
    expect(acceptRelayRequest(req({}), lookup)?.relay).toBe(relay);
  });

  it("refuse anything else", () => {
    expect(acceptRelayRequest(req({ url: "/cdp/s2" }), lookup)).toBeNull();
    expect(acceptRelayRequest(req({ url: "/json/version" }), lookup)).toBeNull();
    expect(
      acceptRelayRequest(req({ headers: { [BROWSER_RELAY_SECRET_HEADER]: "wrong" } }), lookup),
    ).toBeNull();
    expect(
      acceptRelayRequest(req({ headers: { origin: "http://evil.example" } }), lookup),
    ).toBeNull();
    expect(acceptRelayRequest(req({ address: "192.168.1.20" }), lookup)).toBeNull();
    const noSecret = req({});
    delete (noSecret.headers as Record<string, string>)[BROWSER_RELAY_SECRET_HEADER];
    expect(acceptRelayRequest(noSecret, lookup)).toBeNull();
  });
});
