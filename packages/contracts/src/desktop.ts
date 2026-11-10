import { z } from "zod";
import { Id, Timestamp } from "./common";
import type { InboxItem } from "./entities/inbox";
import type { Session } from "./entities/session";
import { BrowserCookie, BrowserHandoffTab, BrowserRelayEndpoint } from "./runner/browser";

/**
 * The desktop app (§17): an Electron shell around the same server and UI. Everything that
 * crosses between its processes (main <-> server child over Node IPC, main <-> UI through the
 * preload bridge, the OS <-> main through `codeden://` links) is defined here.
 */

// ---------------------------------------------------------------- activity (tray, badge)

/**
 * `GET /api/activity`: what the tray, the app icon badge and "keep awake" need, without
 * loading the whole snapshot. Counts never depend on which provider runs a session.
 */
export const ActivitySummary = z.object({
  /** Sessions with a turn starting or in progress. */
  running: z.int().nonnegative(),
  /** Sessions blocked on the user (an approval or a question). */
  waiting: z.int().nonnegative(),
  /** Open inbox items (questions, approvals, PRs to review, failures, ...). */
  inbox: z.int().nonnegative(),
});
export type ActivitySummary = z.infer<typeof ActivitySummary>;

/** Count running and waiting sessions and open inbox items. */
export function summarizeActivity(
  sessions: ReadonlyArray<Pick<Session, "status">>,
  inbox: ReadonlyArray<Pick<InboxItem, "status">>,
): ActivitySummary {
  let running = 0;
  let waiting = 0;
  for (const s of sessions) {
    if (s.status === "running" || s.status === "starting") running++;
    else if (s.status === "waiting") waiting++;
  }
  return { running, waiting, inbox: inbox.filter((i) => i.status === "open").length };
}

// ---------------------------------------------------------------- desktop updates

/**
 * Where the desktop updater is. `available`: a newer release was found and is not downloaded
 * yet; `downloaded`: it installs on restart (or on quit in `auto` mode); `installing`: the app
 * is stopping the runner and handing over to the installer.
 */
export const DesktopUpdatePhase = z.enum([
  "idle",
  "checking",
  "available",
  "downloading",
  "downloaded",
  "installing",
  "error",
]);
export type DesktopUpdatePhase = z.infer<typeof DesktopUpdatePhase>;

/** The desktop updater's state, mirrored into `GET /api/updates` for the update banner. */
export const DesktopUpdateState = z.object({
  phase: DesktopUpdatePhase,
  /** The running app version. */
  current: z.string(),
  /** The newest release found, null until a check succeeded. */
  latest: z.string().nullable(),
  checkedAt: Timestamp.nullable(),
  /** Download progress (0-100) while `downloading`. */
  percent: z.number().min(0).max(100).nullable(),
  /** Why the last check or download failed. */
  error: z.string().nullable(),
  /** Set when this build cannot update itself (a development run, an unsigned macOS app). */
  unsupported: z.string().nullable(),
});
export type DesktopUpdateState = z.infer<typeof DesktopUpdateState>;

/** What the server asks the desktop updater to do (driven by the update banner and policy). */
export const DesktopUpdateCommand = z.enum(["check", "download", "install"]);
export type DesktopUpdateCommand = z.infer<typeof DesktopUpdateCommand>;

// ---------------------------------------------------------------- main <-> server child IPC

/** Server child -> desktop main process. */
export const DesktopServerMessage = z.discriminatedUnion("type", [
  /** Listening; `launchUrl` authenticates the window on first load. */
  z.object({
    type: z.literal("ready"),
    url: z.string(),
    port: z.int().min(1).max(65535),
    launchUrl: z.string(),
    version: z.string(),
  }),
  /** The server could not start (`code` is e.g. `EADDRINUSE`). */
  z.object({ type: z.literal("failed"), message: z.string(), code: z.string().nullable() }),
  /** Run an updater command; answered with `update.done` carrying the same `id`. */
  z.object({ type: z.literal("update.command"), id: z.string(), command: DesktopUpdateCommand }),
]);
export type DesktopServerMessage = z.infer<typeof DesktopServerMessage>;

/** Desktop main process -> server child. */
export const DesktopHostMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("update.state"), state: DesktopUpdateState }),
  z.object({ type: z.literal("update.done"), id: z.string(), error: z.string().nullable() }),
  /** Close the server; with `stopRunner` the runner drains and exits too (as `codeden stop`). */
  z.object({ type: z.literal("shutdown"), stopRunner: z.boolean() }),
]);
export type DesktopHostMessage = z.infer<typeof DesktopHostMessage>;

// ---------------------------------------------------------------- codeden:// links

/** The custom URL scheme the desktop app registers. */
export const DEEP_LINK_SCHEME = "codeden";

/** Where a `codeden://` link points. */
export const DeepLinkTarget = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("home") }),
  z.object({ kind: z.literal("inbox") }),
  z.object({ kind: z.literal("session"), sessionId: Id }),
  z.object({ kind: z.literal("project"), projectId: Id }),
  z.object({ kind: z.literal("settings"), section: z.string().nullable() }),
]);
export type DeepLinkTarget = z.infer<typeof DeepLinkTarget>;

const SEGMENT = /^[A-Za-z0-9_-]{1,200}$/;

/**
 * Parse `codeden://session/<id>`, `codeden://project/<id>`, `codeden://inbox`,
 * `codeden://settings[/<section>]` or `codeden://` (home). Anything else, including other
 * schemes and ids with unexpected characters, is null.
 */
export function parseDeepLink(raw: string): DeepLinkTarget | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== `${DEEP_LINK_SCHEME}:`) return null;
  // `codeden://session/abc` parses with host "session"; `codeden:session/abc` without.
  const parts = [url.host, ...url.pathname.split("/")].filter(Boolean).map(decodeSegment);
  if (parts.some((p) => p === null || !SEGMENT.test(p))) return null;
  const [kind, id, ...rest] = parts as string[];
  if (rest.length > 0) return null;
  switch (kind) {
    case undefined:
    case "home":
      return id === undefined ? { kind: "home" } : null;
    case "inbox":
      return id === undefined ? { kind: "inbox" } : null;
    case "session":
      return id ? { kind: "session", sessionId: id } : null;
    case "project":
      return id ? { kind: "project", projectId: id } : null;
    case "settings":
      return { kind: "settings", section: id ?? null };
    default:
      return null;
  }
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/** The UI route a link opens, e.g. `/sessions/<id>`. */
export function deepLinkPath(target: DeepLinkTarget): string {
  switch (target.kind) {
    case "home":
      return "/";
    case "inbox":
      return "/inbox";
    case "session":
      return `/sessions/${encodeURIComponent(target.sessionId)}`;
    case "project":
      return `/projects/${encodeURIComponent(target.projectId)}`;
    case "settings":
      return target.section ? `/settings/${encodeURIComponent(target.section)}` : "/settings";
  }
}

/** The `codeden://` link for a target (the inverse of `parseDeepLink`). */
export function deepLinkUrl(target: DeepLinkTarget): string {
  const base = `${DEEP_LINK_SCHEME}://`;
  switch (target.kind) {
    case "home":
      return base;
    case "inbox":
      return `${base}inbox`;
    case "session":
      return `${base}session/${encodeURIComponent(target.sessionId)}`;
    case "project":
      return `${base}project/${encodeURIComponent(target.projectId)}`;
    case "settings":
      return target.section
        ? `${base}settings/${encodeURIComponent(target.section)}`
        : `${base}settings`;
  }
}

// ---------------------------------------------------------------- the preload bridge

/** Facts about the desktop app, for About and feature detection. */
export const DesktopInfo = z.object({
  version: z.string(),
  platform: z.enum(["win32", "darwin", "linux"]),
  /** True for an installed build (false when run from the repository). */
  packaged: z.boolean(),
  /** The app started this server (false when it attached to one started by `codeden`). */
  ownsServer: z.boolean(),
  /** The OS lets the app start at login (not on Linux AppImage, for example). */
  launchAtLoginSupported: z.boolean(),
  /**
   * The app can show session browsers as native views (§17 Phase 2), through
   * `CodedenDesktopApi.browser`. Absent from older apps.
   */
  nativeBrowser: z.boolean().optional(),
});
export type DesktopInfo = z.infer<typeof DesktopInfo>;

/** A native notification request from the UI. */
export const DesktopNotification = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(2000).optional(),
  /** Passed back to `onNotificationClick` when the user clicks it. */
  tag: z.string().max(200).optional(),
});
export type DesktopNotification = z.infer<typeof DesktopNotification>;

/**
 * `window.codedenDesktop`, exposed by the desktop app's preload script through
 * `contextBridge`. The UI never asks "am I in Electron?": it checks that this object exists
 * and builds the desktop `PlatformBridge` (§13) from it. Every method validates its input in
 * the main process.
 */
export interface CodedenDesktopApi {
  info(): Promise<DesktopInfo>;
  /** Native folder picker; resolves with an absolute path, or null when cancelled. */
  pickFolder(opts?: { title?: string; defaultPath?: string }): Promise<string | null>;
  notify(notification: DesktopNotification): void;
  /** Called with the `tag` of a notification the user clicked (the window is focused first). */
  onNotificationClick(listener: (tag: string) => void): () => void;
  /** Open an http(s) or mailto link in the system browser. */
  openExternal(url: string): void;
  /** Unread count on the app icon (dock badge, taskbar overlay, Unity launcher). */
  setBadge(count: number): void;
  /** Called with a UI route (e.g. `/sessions/<id>`) when a `codeden://` link is opened. */
  onNavigate(listener: (path: string) => void): () => void;
  /** Native browser views (§17 Phase 2); absent from older apps. */
  browser?: CodedenDesktopBrowserApi;
}

// ---------------------------------------------------------------- native browser views

/**
 * Where a session's native view goes: the panel's content box in the UI page's CSS pixels
 * (`getBoundingClientRect`). The main process scales it by the window's zoom and snaps it to
 * device pixels.
 */
export const NativeBrowserBounds = z.object({
  x: z.number().min(-16_384).max(16_384),
  y: z.number().min(-16_384).max(16_384),
  width: z.number().min(0).max(16_384),
  height: z.number().min(0).max(16_384),
});
export type NativeBrowserBounds = z.infer<typeof NativeBrowserBounds>;

/** `browser.show` over the bridge, validated in the main process. */
export const NativeBrowserShow = z.object({ sessionId: Id, bounds: NativeBrowserBounds });
export type NativeBrowserShow = z.infer<typeof NativeBrowserShow>;

/**
 * A CodeDen shortcut pressed while a native view had keyboard focus (the view would otherwise
 * swallow it). The UI replays it as a `keydown` on its window.
 */
export const NativeBrowserShortcut = z.object({
  key: z.string().min(1).max(40),
  code: z.string().max(40),
  ctrlKey: z.boolean(),
  metaKey: z.boolean(),
  altKey: z.boolean(),
  shiftKey: z.boolean(),
});
export type NativeBrowserShortcut = z.infer<typeof NativeBrowserShortcut>;

/**
 * App shortcuts a focused native view hands to the UI instead of the page, as combos in the
 * UI's shortcut registry format (`mod` is Ctrl, or Cmd on macOS). Only combos with Ctrl/Cmd or
 * Alt: typing in the page is never taken away.
 */
export const NATIVE_BROWSER_APP_SHORTCUTS = [
  "mod+k",
  "mod+shift+l",
  "mod+,",
  "alt+o",
  "alt+i",
  "mod+b",
  "mod+\\",
  "mod+j",
  "alt+1",
  "alt+2",
  "alt+3",
  "alt+4",
  "alt+5",
  "alt+6",
  "mod+.",
  "mod+shift+m",
  "alt+m",
] as const;

/**
 * `window.codedenDesktop.browser`: shows a session's native browser view (one per tab, the
 * active tab on top) over the panel. Tabs, navigation and agent tools go through the server and
 * the runner, as for the screencast; this API only places the view, which the UI can't do.
 */
export interface CodedenDesktopBrowserApi {
  /** Show the session's active view over `bounds` (and hide every other session's views). */
  show(sessionId: string, bounds: NativeBrowserBounds): void;
  /** Hide the session's views: the panel is hidden, or a menu or dialog covers it. */
  hide(sessionId: string): void;
  /** A PNG data URL of the session's active view, for a placeholder while it is hidden. */
  capture(sessionId: string): Promise<string | null>;
  /** Open DevTools for the session's active view. */
  inspect(sessionId: string): void;
  /** App shortcuts pressed while a native view had keyboard focus. */
  onShortcut(listener: (shortcut: NativeBrowserShortcut) => void): () => void;
}

// ---------------------------------------------------------------- the browser host channel

/**
 * `/ws/browser-host`: the desktop app's main process offers native browser views to the server
 * (§17 Phase 2). Loopback only, with the install token, in both directions of the app's two
 * modes (it started the server, or attached to one `codeden` started). One app per home.
 */

/** Desktop app -> server. */
export const BrowserHostClientMessage = z.discriminatedUnion("type", [
  /** Sent once on connect: this app can host native views. */
  z.object({ type: z.literal("hello"), version: z.string().max(100) }),
  /** Answer to `attach`: the session's relay. */
  z.object({ type: z.literal("attached"), id: z.string().max(100), relay: BrowserRelayEndpoint }),
  /** Answer to `attach` when the app can't host the session (the server falls back). */
  z.object({ type: z.literal("failed"), id: z.string().max(100), message: z.string().max(2_000) }),
  /**
   * The app is quitting: move these sessions to the runner's Chromium (tabs at their URLs, with
   * their cookies). Answered with `handoff.done` once the runner has them, or not at all if the
   * server is gone (the app quits after a timeout).
   */
  z.object({
    type: z.literal("handoff"),
    id: z.string().max(100),
    sessions: z
      .array(
        z.object({
          sessionId: Id,
          tabs: z.array(BrowserHandoffTab).max(50),
          cookies: z.array(BrowserCookie).max(5_000),
        }),
      )
      .max(500),
  }),
]);
export type BrowserHostClientMessage = z.infer<typeof BrowserHostClientMessage>;

/** Server -> desktop app. */
export const BrowserHostServerMessage = z.discriminatedUnion("type", [
  /** Create (or reuse) the session's native browser and answer with its relay. */
  z.object({ type: z.literal("attach"), id: z.string().max(100), sessionId: Id }),
  /** The hand-off finished; `failed` lists sessions the runner could not take over. */
  z.object({
    type: z.literal("handoff.done"),
    id: z.string().max(100),
    failed: z.array(Id),
  }),
]);
export type BrowserHostServerMessage = z.infer<typeof BrowserHostServerMessage>;
