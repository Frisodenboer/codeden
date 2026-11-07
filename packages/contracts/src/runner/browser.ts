import { z } from "zod";
import { Id } from "../common";

/** Runner-assigned tab id, unique within a session's browser context (`t1`, `t2`, ...). */
export const BrowserTabId = z.string().min(1).max(100);
export type BrowserTabId = z.infer<typeof BrowserTabId>;

/** One tab of a session's browser context. */
export const BrowserTab = z.object({
  tabId: BrowserTabId,
  url: z.string(),
  title: z.string(),
  /** The tab shown in the panel and targeted when a command omits `tabId`. */
  active: z.boolean(),
});
export type BrowserTab = z.infer<typeof BrowserTab>;

/** CDP modifier bitmask: Alt = 1, Ctrl = 2, Meta = 4, Shift = 8. */
export const BrowserModifiers = z.int().min(0).max(15);

/**
 * Aria ref from a `browser.snapshot` (`e2`, or `f1e3` inside an iframe). Refs resolve
 * against the latest snapshot of the tab.
 */
export const BrowserElementRef = z.string().regex(/^(f\d+)?e\d+$/);

/**
 * Pointer input from the panel. `x`/`y` are in the coordinate space of the frame as it
 * is displayed (`frameWidth` x `frameHeight`); the runner maps them onto the page viewport.
 */
export const BrowserMouseInput = z.object({
  type: z.enum(["mouse.move", "mouse.down", "mouse.up", "mouse.wheel"]),
  x: z.number(),
  y: z.number(),
  frameWidth: z.number().positive(),
  frameHeight: z.number().positive(),
  button: z.enum(["none", "left", "middle", "right"]).optional(),
  clickCount: z.int().min(0).max(3).optional(),
  /** Wheel deltas in CSS pixels (`mouse.wheel`). */
  deltaX: z.number().optional(),
  deltaY: z.number().optional(),
  modifiers: BrowserModifiers.optional(),
});
export type BrowserMouseInput = z.infer<typeof BrowserMouseInput>;

/** Keyboard input from the panel, mirroring DOM `KeyboardEvent` fields. */
export const BrowserKeyInput = z.object({
  type: z.enum(["key.down", "key.up", "key.char"]),
  /** DOM `key`, e.g. `a`, `Enter`, `ArrowLeft`. */
  key: z.string().min(1).max(40),
  /** DOM `code`, e.g. `KeyA`. */
  code: z.string().max(40).optional(),
  /** Text the key produces (printable keys). */
  text: z.string().max(10).optional(),
  modifiers: BrowserModifiers.optional(),
});
export type BrowserKeyInput = z.infer<typeof BrowserKeyInput>;

/** Insert text at the focused element as if typed by an IME (paste-like). */
export const BrowserTextInput = z.object({
  type: z.literal("text.insert"),
  text: z.string().max(100_000),
});
export type BrowserTextInput = z.infer<typeof BrowserTextInput>;

/** Human input forwarded from the panel to the active tab. */
export const BrowserInput = z.union([BrowserMouseInput, BrowserKeyInput, BrowserTextInput]);
export type BrowserInput = z.infer<typeof BrowserInput>;

/** A console message (or uncaught page error) captured from a tab. Bounded per session. */
export const BrowserConsoleEntry = z.object({
  /** Monotonic per session; pass as `since` to page through new entries. */
  id: z.int().nonnegative(),
  tabId: BrowserTabId,
  /** `log`, `info`, `warning`, `error`, `debug`, ..., or `pageerror`. */
  level: z.string(),
  text: z.string(),
  url: z.string().optional(),
  line: z.int().optional(),
  ts: z.string(),
});
export type BrowserConsoleEntry = z.infer<typeof BrowserConsoleEntry>;

/** A network request made by a tab. Bounded per session. */
export const BrowserNetworkEntry = z.object({
  id: z.int().nonnegative(),
  tabId: BrowserTabId,
  method: z.string(),
  url: z.string(),
  resourceType: z.string(),
  /** HTTP status; null while pending or when the request failed. */
  status: z.int().nullable(),
  /** Failure text (`net::ERR_...`) when the request failed. */
  failure: z.string().nullable(),
  ts: z.string(),
  durationMs: z.number().nullable(),
});
export type BrowserNetworkEntry = z.infer<typeof BrowserNetworkEntry>;

/** Screencast frame metadata from CDP `Page.screencastFrame` (CSS pixels). */
export const BrowserFrameMetadata = z.object({
  /** Seconds since epoch when the frame was produced. */
  timestamp: z.number().optional(),
  deviceWidth: z.number(),
  deviceHeight: z.number(),
  pageScaleFactor: z.number(),
  offsetTop: z.number(),
  scrollOffsetX: z.number(),
  scrollOffsetY: z.number(),
});
export type BrowserFrameMetadata = z.infer<typeof BrowserFrameMetadata>;

const TabTarget = { sessionId: Id, tabId: BrowserTabId.optional() };

/** `browser.*` commands (§12.2), spread into `RunnerCommand`. */
export const BrowserCommands = [
  /** Open (or reuse) the session's browser context; opens a first tab (at `url`) if none. */
  z.object({ name: z.literal("browser.open"), sessionId: Id, url: z.string().optional() }),
  /** Navigate a tab (default: the active one). Bare `host:port` gets `http://`. */
  z.object({ name: z.literal("browser.navigate"), ...TabTarget, url: z.string() }),
  /** Close the session's context and all its tabs. */
  z.object({ name: z.literal("browser.close"), sessionId: Id }),
  z.object({
    name: z.literal("browser.history"),
    ...TabTarget,
    action: z.enum(["back", "forward", "reload"]),
  }),
  z.object({ name: z.literal("browser.tabs.list"), sessionId: Id }),
  z.object({ name: z.literal("browser.tabs.open"), sessionId: Id, url: z.string().optional() }),
  z.object({ name: z.literal("browser.tabs.close"), sessionId: Id, tabId: BrowserTabId }),
  z.object({ name: z.literal("browser.tabs.activate"), sessionId: Id, tabId: BrowserTabId }),
  /** Resize the viewport of every tab in the session (CSS pixels). */
  z.object({
    name: z.literal("browser.viewport"),
    sessionId: Id,
    width: z.int().min(200).max(7680),
    height: z.int().min(200).max(4320),
  }),
  /**
   * Add (`watching: true`) or remove a panel viewer. Frames stream as `browser.frame` while
   * at least one viewer watches; the screencast pauses when the last one leaves.
   */
  z.object({
    name: z.literal("browser.screencast"),
    sessionId: Id,
    viewerId: z.string().min(1).max(200),
    watching: z.boolean(),
    quality: z.int().min(10).max(100).optional(),
    maxWidth: z.int().min(100).max(7680).optional(),
    maxHeight: z.int().min(100).max(4320).optional(),
    maxFps: z.int().min(1).max(60).optional(),
  }),
  /** Forward human input to the active tab. */
  z.object({ name: z.literal("browser.input"), sessionId: Id, input: BrowserInput }),
  /** Open `http://localhost:<port><path>` in a new tab of the session. */
  z.object({
    name: z.literal("browser.devServer"),
    sessionId: Id,
    port: z.int().min(1).max(65535),
    path: z.string().startsWith("/").optional(),
  }),
  /** Accessibility snapshot (YAML) with element refs for click/type. */
  z.object({ name: z.literal("browser.snapshot"), ...TabTarget }),
  z.object({
    name: z.literal("browser.click"),
    ...TabTarget,
    ref: BrowserElementRef,
    button: z.enum(["left", "middle", "right"]).optional(),
    doubleClick: z.boolean().optional(),
  }),
  /** Fill an editable element by ref; `submit` presses Enter afterwards. */
  z.object({
    name: z.literal("browser.type"),
    ...TabTarget,
    ref: BrowserElementRef,
    text: z.string().max(100_000),
    submit: z.boolean().optional(),
  }),
  /** Press a key or chord on the focused element, e.g. `Enter`, `Control+A`. */
  z.object({ name: z.literal("browser.press"), ...TabTarget, key: z.string().min(1).max(60) }),
  /** PNG screenshot of the viewport, the full page, or one element (`ref`) to an absolute path. */
  z.object({
    name: z.literal("browser.screenshot"),
    ...TabTarget,
    path: z.string().min(1),
    fullPage: z.boolean().optional(),
    ref: BrowserElementRef.optional(),
  }),
  /** Console messages and/or network requests captured since `since` (exclusive). */
  z.object({
    name: z.literal("browser.logs"),
    ...TabTarget,
    /** Default `all`. */
    kind: z.enum(["console", "network", "all"]).optional(),
    since: z.int().nonnegative().optional(),
    limit: z.int().min(1).max(1000).optional(),
  }),
  /** Evaluate a JS expression or function source in the tab (guarded: timeout, size cap). */
  z.object({
    name: z.literal("browser.evaluate"),
    ...TabTarget,
    expression: z.string().min(1).max(20_000),
  }),
  /** Wait for a selector, visible text, or network idle (exactly one). */
  z.object({
    name: z.literal("browser.wait"),
    ...TabTarget,
    selector: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    networkIdle: z.boolean().optional(),
    timeoutMs: z.int().min(1).max(120_000).optional(),
  }),
] as const;

const Empty = z.object({});
const TabResult = z.object({ tab: BrowserTab });

/** Result schemas for `browser.*` commands, spread into `RunnerCommandResults`. */
export const BrowserCommandResults = {
  /** `cdpUrl` is the browser's CDP endpoint on 127.0.0.1. */
  "browser.open": z.object({ cdpUrl: z.string().nullable(), tabs: z.array(BrowserTab).optional() }),
  "browser.navigate": z.object({
    url: z.string().optional(),
    status: z.int().nullable().optional(),
  }),
  "browser.close": Empty,
  "browser.history": z.object({ url: z.string() }),
  "browser.tabs.list": z.object({ tabs: z.array(BrowserTab) }),
  "browser.tabs.open": TabResult,
  "browser.tabs.close": Empty,
  "browser.tabs.activate": Empty,
  "browser.viewport": Empty,
  "browser.screencast": z.object({ viewers: z.int().nonnegative() }),
  "browser.input": Empty,
  "browser.devServer": TabResult,
  "browser.snapshot": z.object({
    tabId: BrowserTabId,
    url: z.string(),
    title: z.string(),
    snapshot: z.string(),
    truncated: z.boolean(),
  }),
  "browser.click": Empty,
  "browser.type": Empty,
  "browser.press": Empty,
  "browser.screenshot": z.object({
    path: z.string(),
    width: z.int().positive(),
    height: z.int().positive(),
    bytes: z.int().positive(),
  }),
  "browser.logs": z.object({
    console: z.array(BrowserConsoleEntry),
    network: z.array(BrowserNetworkEntry),
  }),
  /** JSON-serialized result (truncated to the size cap). */
  "browser.evaluate": z.object({ json: z.string(), truncated: z.boolean() }),
  "browser.wait": z.object({ matched: z.boolean() }),
};
