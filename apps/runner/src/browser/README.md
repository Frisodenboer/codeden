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
| `session.ts` | `BrowserSession`: tabs (`t1`, `t2`, ...; popups are adopted), active tab, navigate/back/forward/reload, viewport, input forwarding, `browser.tabs` stream updates |
| `screencast.ts` | `Page.startScreencast` on the active tab, JPEG frames as `browser.frame` stream data with metadata, throttled by delaying `Page.screencastFrameAck`, paused when the last viewer leaves, follows tab switches |
| `input.ts` | Panel mouse/keyboard -> `Input.dispatchMouseEvent` / `dispatchKeyEvent` / `insertText`, coordinates mapped from the displayed frame size |
| `agent.ts` | Agent primitives: aria snapshot with refs, click/type by ref, press, screenshot (viewport, full page, element) to a path, guarded evaluate, wait for selector/text/network idle |
| `logs.ts` | Bounded console and network logs per session (ring buffers, `since` paging) |
| `handlers.ts` | `createBrowserCommandHandlers({ manager })`: one handler per `browser.*` runner command |

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
