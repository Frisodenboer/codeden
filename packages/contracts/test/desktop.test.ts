import { describe, expect, it } from "vitest";
import {
  ActivitySummary,
  BrowserHostClientMessage,
  BrowserHostServerMessage,
  type DeepLinkTarget,
  DesktopHostMessage,
  DesktopInfo,
  DesktopNotification,
  DesktopServerMessage,
  DesktopUpdateState,
  deepLinkPath,
  deepLinkUrl,
  defaultSettings,
  InstallSource,
  NATIVE_BROWSER_APP_SHORTCUTS,
  NativeBrowserShortcut,
  NativeBrowserShow,
  parseDeepLink,
  Settings,
  summarizeActivity,
} from "../src";

const updateState: DesktopUpdateState = {
  phase: "downloading",
  current: "0.1.1",
  latest: "0.2.0",
  checkedAt: "2026-11-08T10:00:00.000Z",
  percent: 42.5,
  error: null,
  unsupported: null,
};

describe("desktop activity", () => {
  it("counts running and waiting sessions and open inbox items", () => {
    const summary = summarizeActivity(
      [
        { status: "running" },
        { status: "starting" },
        { status: "waiting" },
        { status: "idle" },
        { status: "completed" },
      ],
      [{ status: "open" }, { status: "open" }, { status: "resolved" }],
    );
    expect(summary).toEqual({ running: 2, waiting: 1, inbox: 2 });
    expect(ActivitySummary.parse(JSON.parse(JSON.stringify(summary)))).toEqual(summary);
  });

  it("rejects negative counts", () => {
    expect(ActivitySummary.safeParse({ running: -1, waiting: 0, inbox: 0 }).success).toBe(false);
  });
});

describe("desktop update state and IPC", () => {
  it("round-trips the update state", () => {
    expect(DesktopUpdateState.parse(JSON.parse(JSON.stringify(updateState)))).toEqual(updateState);
    expect(DesktopUpdateState.safeParse({ ...updateState, percent: 120 }).success).toBe(false);
  });

  it("round-trips every server -> main message", () => {
    const messages: DesktopServerMessage[] = [
      {
        type: "ready",
        url: "http://127.0.0.1:4317",
        port: 4317,
        launchUrl: "http://127.0.0.1:4317/?token=abc",
        version: "0.1.1",
      },
      { type: "failed", message: "Port 4317 is in use", code: "EADDRINUSE" },
      { type: "update.command", id: "1", command: "check" },
      { type: "update.command", id: "2", command: "download" },
      { type: "update.command", id: "3", command: "install" },
    ];
    for (const m of messages) {
      expect(DesktopServerMessage.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
    }
    expect(DesktopServerMessage.safeParse({ type: "update.command", id: "x" }).success).toBe(false);
  });

  it("round-trips every main -> server message", () => {
    const messages: DesktopHostMessage[] = [
      { type: "update.state", state: updateState },
      { type: "update.done", id: "1", error: null },
      { type: "update.done", id: "2", error: "offline" },
      { type: "shutdown", stopRunner: true },
    ];
    for (const m of messages) {
      expect(DesktopHostMessage.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
    }
  });

  it("knows the desktop install source", () => {
    expect(InstallSource.parse("desktop")).toBe("desktop");
  });
});

describe("codeden:// links", () => {
  const cases: Array<[string, DeepLinkTarget, string]> = [
    ["codeden://", { kind: "home" }, "/"],
    ["codeden://inbox", { kind: "inbox" }, "/inbox"],
    ["codeden://session/s_123", { kind: "session", sessionId: "s_123" }, "/sessions/s_123"],
    ["codeden://project/p-9", { kind: "project", projectId: "p-9" }, "/projects/p-9"],
    ["codeden://settings", { kind: "settings", section: null }, "/settings"],
    ["codeden://settings/desktop", { kind: "settings", section: "desktop" }, "/settings/desktop"],
  ];

  it("parses links into targets and routes", () => {
    for (const [url, target, path] of cases) {
      expect(parseDeepLink(url)).toEqual(target);
      expect(deepLinkPath(target)).toBe(path);
      expect(parseDeepLink(deepLinkUrl(target))).toEqual(target);
    }
  });

  it("accepts trailing slashes and the scheme in any case", () => {
    expect(parseDeepLink("codeden://session/abc/")).toEqual({ kind: "session", sessionId: "abc" });
    expect(parseDeepLink("CODEDEN://inbox")).toEqual({ kind: "inbox" });
  });

  it("rejects other schemes, unknown targets and odd ids", () => {
    for (const url of [
      "https://example.com/session/abc",
      "codeden://unknown",
      "codeden://session",
      "codeden://session/a/b",
      "codeden://session/..%2F..%2Fapi",
      "codeden://session/%3Cscript%3E",
      "codeden://inbox/extra",
      "not a url",
    ]) {
      expect(parseDeepLink(url), url).toBeNull();
    }
  });
});

describe("desktop bridge payloads", () => {
  it("round-trips info and notifications", () => {
    const info: DesktopInfo = {
      version: "0.1.1",
      platform: "win32",
      packaged: true,
      ownsServer: true,
      launchAtLoginSupported: true,
    };
    expect(DesktopInfo.parse(JSON.parse(JSON.stringify(info)))).toEqual(info);
    const n: DesktopNotification = { title: "Approval needed", body: "rm -rf dist", tag: "i1" };
    expect(DesktopNotification.parse(n)).toEqual(n);
    expect(DesktopNotification.safeParse({ title: "" }).success).toBe(false);
    // Older apps don't report native browser support.
    expect(DesktopInfo.parse({ ...info, nativeBrowser: true }).nativeBrowser).toBe(true);
    expect(DesktopInfo.parse(info).nativeBrowser).toBeUndefined();
  });

  it("validates native view placement and forwarded shortcuts", () => {
    const show: NativeBrowserShow = {
      sessionId: "s1",
      bounds: { x: 812.5, y: 96, width: 460, height: 700.25 },
    };
    expect(NativeBrowserShow.parse(JSON.parse(JSON.stringify(show)))).toEqual(show);
    for (const bad of [
      { sessionId: "s1", bounds: { x: 0, y: 0, width: -1, height: 10 } },
      { sessionId: "s1", bounds: { x: 0, y: 0, width: 10, height: Number.NaN } },
      { sessionId: "s1", bounds: { x: 1e9, y: 0, width: 10, height: 10 } },
      { sessionId: "", bounds: { x: 0, y: 0, width: 10, height: 10 } },
    ]) {
      expect(NativeBrowserShow.safeParse(bad).success).toBe(false);
    }
    const key: NativeBrowserShortcut = {
      key: "k",
      code: "KeyK",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    expect(NativeBrowserShortcut.parse(key)).toEqual(key);
    // Only combos with a modifier: plain typing always stays in the page.
    for (const combo of NATIVE_BROWSER_APP_SHORTCUTS) expect(combo).toMatch(/^(mod|alt)\+/);
  });
});

describe("browser host channel", () => {
  const relay = {
    url: "ws://127.0.0.1:51234/cdp/s1",
    secret: "a".repeat(64),
  };

  it("round-trips every message in both directions", () => {
    const fromApp: BrowserHostClientMessage[] = [
      { type: "hello", version: "0.5.0" },
      { type: "attached", id: "r1", relay },
      { type: "failed", id: "r2", message: "The window is closing" },
      {
        type: "handoff",
        id: "h1",
        sessions: [
          {
            sessionId: "s1",
            tabs: [
              { url: "http://localhost:5173/", active: true },
              { url: "https://example.com/a", active: false },
            ],
            cookies: [
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
                path: "/",
                expires: 1_900_000_000,
                httpOnly: false,
                secure: true,
                sameSite: "None",
              },
            ],
          },
        ],
      },
    ];
    for (const m of fromApp) {
      expect(BrowserHostClientMessage.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
    }
    const fromServer: BrowserHostServerMessage[] = [
      { type: "attach", id: "r1", sessionId: "s1" },
      { type: "handoff.done", id: "h1", failed: ["s2"] },
    ];
    for (const m of fromServer) {
      expect(BrowserHostServerMessage.parse(JSON.parse(JSON.stringify(m)))).toEqual(m);
    }
  });

  it("accepts only loopback relays with a real secret", () => {
    const attached = (r: object) =>
      BrowserHostClientMessage.safeParse({ type: "attached", id: "r1", relay: r }).success;
    expect(attached(relay)).toBe(true);
    expect(attached({ ...relay, url: "ws://0.0.0.0:51234/cdp/s1" })).toBe(false);
    expect(attached({ ...relay, url: "ws://192.168.1.4:51234/cdp/s1" })).toBe(false);
    expect(attached({ ...relay, url: "ws://127.0.0.1:51234/cdp/../x" })).toBe(false);
    expect(attached({ ...relay, secret: "short" })).toBe(false);
  });
});

describe("desktop settings", () => {
  it("defaults to close-to-tray and keep-awake, not launch at login", () => {
    expect(defaultSettings().desktop).toEqual({
      launchAtLogin: false,
      closeToTray: true,
      keepAwake: true,
      nativeBrowser: true,
    });
  });

  it("keeps older settings files valid and round-trips changes", () => {
    const parsed = Settings.parse({ desktop: { launchAtLogin: true } });
    expect(parsed.desktop).toEqual({
      launchAtLogin: true,
      closeToTray: true,
      keepAwake: true,
      nativeBrowser: true,
    });
    expect(Settings.parse({ desktop: { nativeBrowser: false } }).desktop.nativeBrowser).toBe(false);
    expect(Settings.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  });
});
