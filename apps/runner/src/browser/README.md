# Runner browser engine

The runner owns one Chromium (DESIGN §12.2). Every CodeDen session gets its own
`BrowserContext`, so cookies, storage and tabs never cross sessions. Humans watch and
take over through a CDP screencast; agents drive the same tabs through a small set of
primitives. All of it goes through CDP, the seam that lets a native browser view replace
the panel later (§17).

## Modules

| File | Concern |
|---|---|
| `launcher.ts` | Finds and launches installed Edge/Chrome via playwright-core `channel` (Edge first on Windows, Chrome first elsewhere), optional consented fallback to a downloaded Chromium, CDP endpoint on `127.0.0.1:<free port>`, browser pid via `SystemInfo.getProcessInfo` |
| `manager.ts` | `BrowserManager`: lazy launch, one context per session, `openDevServer(port)`, shutdown that kills the browser process tree |
| `session.ts` | `BrowserSession`: tabs (`t1`, `t2`, ...; popups are adopted), active tab, navigate/back/forward/reload, viewport emulation on every tab, input forwarding, `browser.tabs` stream updates |
| `viewport.ts` | Viewport policy: clamps (`fitViewport`), frame pixel size (`framePixels`), `Emulation.setDeviceMetricsOverride` parameters |
| `screencast.ts` | `Page.startScreencast` on the active tab, JPEG frames sized to the viewport's device pixels as `browser.frame` stream data with metadata, throttled by delaying `Page.screencastFrameAck`, paused when the last viewer leaves, follows tab switches, restarts on resize |
| `input.ts` | Panel mouse/keyboard -> `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText`, coordinates mapped from the displayed frame onto the viewport the frame showed |
| `agent.ts` | Agent primitives: aria snapshot with refs, click/type by ref, press, screenshot (viewport, full page, element) to a path, guarded evaluate, wait for selector/text/network idle |
| `logs.ts` | Bounded console and network logs per session (ring buffers, `since` paging) |
| `handlers.ts` | `createBrowserCommandHandlers({ manager })`: one handler per `browser.*` runner command |

## Viewport: the page follows the panel

The panel is a browser surface, not a preview: the page is laid out at the panel's own size
and pixel density, and the frames are drawn 1:1, edge to edge.

1. **The panel measures itself.** A `ResizeObserver` on the panel's content box (below the
   toolbar) reports its CSS width, height and `devicePixelRatio` over `/ws/browser` as a
   `viewport` message: the first size at once, then debounced (120 ms after the resize
   settles, at least every 400 ms during a long drag). DPR changes (another screen, zoom)
   re-report.
2. **One viewer owns the size** (`apps/server/src/realtime/browser-viewport.ts`). The first
   viewer to report owns it. Another viewer takes it over by *claiming*: its window gains
   focus, the panel is pressed, or a fixed size is picked. The page follows the owner's
   reports; the others are remembered. When the owner leaves, the viewer that claimed most
   recently (else the one that reported first) takes over. So opening the panel on a phone
   doesn't resize the page under a desktop viewer, but using the phone does. Each viewer is
   told the applied size and whether it is `mine`: the owner stretches frames over the panel
   (`object-fit: fill`), others fit them inside (`contain`).
3. **The runner emulates it** (`session.setViewport`). Contexts are created with
   `viewport: null`, so one `Emulation.setDeviceMetricsOverride` per tab, on the session's own
   CDP session, owns size and scale (Playwright fixes the scale factor per context). New tabs
   and popups get the current metrics before they are activated; a reopened session browser
   starts at its last size.
4. **The screencast follows.** `maxWidth`/`maxHeight` are the viewport's device pixels, and a
   running screencast restarts on resize. The last frame stays on the panel's canvas,
   stretched, until the first new one arrives: no blank flash.

**Clamps** (`viewport.ts`):

| Limit | Value | Why |
|---|---|---|
| Min CSS size | 320 x 240 | The narrowest layout sites still design for; a smaller panel shows the page scaled down a little instead |
| Max CSS size | 3840 x 2400 | 4K-class panels; bigger is scaled in the panel |
| Device scale | 1 to 2 | Sharp on 1.25x/1.5x/2x screens; 3x phones would cost 2.25x the pixels for little visible gain |
| Frame pixels | at most 2560 x 1600, never below the CSS size | Bounds JPEG encode time and frame size; the scale drops (never below 1) to fit. Frames are never scaled below one pixel per CSS pixel, not for the budget and not for a viewer's `maxWidth`/`maxHeight` (see below) |

**Why the browser runs at 2x.** Screencast frames are captured at the browser's *real*
device scale, not the emulated one (measured: emulating 2x on a 1x browser still yields CSS-
sized frames). The launcher passes `--force-device-scale-factor=2` (the max we emulate) and
`maxWidth`/`maxHeight` scale frames down to each viewport's device pixels, which also
supersamples 1x and 1.25x viewers.

**Frames:** JPEG quality 75 (60 visibly smeared small text at device pixels), at most 20 fps,
only on change, throttled by delaying acks (held-back acks are sent when the screencast
stops); slow sockets skip frames server-side. Because Chromium only sends frames on change,
a still page could leave a viewer with nothing to draw: a new viewer gets the last frame, a
(re)started screencast that sends nothing within 1 s gets a still from
`Page.captureScreenshot`, and a panel that still has no frame after 3 s re-sends `watch`.

**The CSS-size floor (macOS).** Asked for frames smaller than the page's CSS size, Chromium on
macOS misbehaves. Measured on CI: a 1280x800 page capped to 640x400 sent no frames for 750 ms
of page changes, and the frames it did send reported 640x400 as the viewport, which would put
clicks at half the distance. Frames at or above the CSS size are fine there: a 460x712 page at
2x capped to 460x712 sends 460x712 frames with correct metadata. So `startParams` never asks
for less than the CSS viewport, on every platform.

**Input:** the panel maps pointer positions from where the frame is drawn (the whole box, or
the letterboxed rectangle when fitted) into frame pixels and sends the frame's own viewport
(`viewportWidth`/`viewportHeight` from its metadata), so clicks stay exact while a resize is
in flight. Wheel deltas become page CSS pixels (lines are 40 px, pages 87.5% of the
viewport, scaled by how big the page is drawn), are summed per animation frame, and are
capped at 1200 px per event. There is no take-over mode: human input always goes to the
page, also while an agent acts (the panel shows "Agent is acting" from the server's
`agent` activity signal: on while an agent `browser_*` tool runs, plus 2.5 s).

**Agents** are unaffected: snapshots, ref clicks and typing don't depend on the size, and
`browser_screenshot` captures the current viewport in CSS pixels (`scale: "css"`), so a
HiDPI viewer doesn't double the image an agent gets. With no viewer, the page keeps its last
size (default 1280x800).

## Spike: Playwright MCP over CDP vs our own primitives (DESIGN §20, spike 4)

**Decision: use our own primitives on playwright-core. Do not attach Playwright MCP.**

### What was tested

On Windows 11 with Edge 156, `@playwright/mcp@0.0.84`, playwright-core 1.64.1. The runner
launched Edge with a remote-debugging port, created two session contexts (A and B, one
tab each, different cookies), then:

1. Started two Playwright MCP servers with `--cdp-endpoint <our endpoint>` (stdio), one
   per "session".
2. Started one in-process with `createConnection(config, () => contextB)`, the
   programmatic way to hand it a single context.

### Results

- **`--cdp-endpoint`: no confinement.** Each MCP instance listed the tabs of *every*
  context (`0: page-B`, `1: page-A`) and its "current" tab was whichever it found first
  (session B for both instances). `browser_tabs select` plus `browser_navigate` from the
  instance meant for one session navigated the other session's tab. There is no option to
  pin an instance to a context or target. It also writes snapshot files into its working
  directory (`.playwright-mcp/`).
- **In-process `contextGetter`: partial confinement only.** Listing and snapshots stayed
  inside context B, but `browser_tabs` with `isolatedContext` created a new context the
  runner does not manage (no screencast, no isolation bookkeeping), and
  `browser_run_code_unsafe` reached `page.context().browser().contexts()`, i.e. every
  session's pages. It also means bundling `@playwright/mcp` with its own pinned
  pre-release Playwright next to ours and following a 25-tool surface that changes between
  releases.

### Why our own primitives

- Hard isolation: every handler resolves `sessionId -> BrowserSession -> its context`; no
  command can name another session's tab or reach the `Browser` object.
- Same refs and the same mechanics (`page.ariaSnapshot({ mode: "ai" })`,
  `page.getByRef`) that Playwright MCP uses, so agent ergonomics match.
- Humans and agents share the exact tabs the screencast shows; tab changes stream to the
  panel.
- One dependency (playwright-core), no extra process per session, no files written as a
  side effect.

### Screencast latency

Measured on the runner side (before the WebSocket hop to the panel): DOM change to emitted
frame median 6 ms, p90 10 ms at the default 15 fps cap, ~8 KB per 1280x800 JPEG frame
(quality 60). Launch plus first context: ~330 ms. The panel-side hop is not measured yet
(the server/UI wiring is not in this module).

## Notes

- Element refs (`e2`, `f1e3`) come from the latest snapshot of a tab; unchanged elements
  keep their refs across snapshots, a changed element (for example a new accessible name)
  gets a new one. Actions on a missing ref fail fast with "take a new snapshot".
- `evaluate` accepts an expression or function source (functions are called). It is
  CSP-safe, times out (5 s), caps the JSON result (20,000 chars) and can be disabled with
  `new BrowserManager({ evaluate: { enabled: false } })`.
- Navigation refuses `edge://`, `chrome://`, `devtools://` and `javascript:` URLs.
- Shutdown closes every context, closes the browser, then `killTree`s the browser pid if
  anything survived.
