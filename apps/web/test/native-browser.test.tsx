import {
  type CodedenDesktopApi,
  type CodedenDesktopBrowserApi,
  NATIVE_BROWSER_APP_SHORTCUTS,
  type NativeBrowserShortcut,
} from "@codeden/contracts";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserSocketQuery } from "@/lib/api/browser-channel";
import {
  isOccluded,
  overlayElements,
  overlayRects,
  placementKey,
  toNativeBounds,
} from "@/lib/native-browser";
import { selectPlatform } from "@/lib/platform";
import { SHORTCUTS } from "@/lib/shortcuts";

const bridge = vi.hoisted(() => ({ current: null as CodedenDesktopBrowserApi | null }));
vi.mock("@/lib/platform", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/platform")>();
  return {
    ...actual,
    platform: {
      ...actual.platform,
      get nativeBrowser() {
        return bridge.current;
      },
    },
  };
});

const { NativeBrowserView } = await import("@/components/workbench/browser/native-browser-view");

type Box = { x: number; y: number; width: number; height: number };
const rect = (b: Box) =>
  ({ ...b, top: b.y, left: b.x, right: b.x + b.width, bottom: b.y + b.height }) as DOMRect;

/** Give an element a layout box (jsdom has none). */
function place(el: Element, box: Box) {
  el.getBoundingClientRect = () => rect(box);
}

describe("overlays over a native view", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("counts portals and toasts, never the app root or the portal holding the view", () => {
    document.body.innerHTML = `
      <div id="root"><ol><li data-sonner-toast></li></ol></div>
      <div id="menu"></div>
      <div id="sheet"><div id="host"></div></div>
      <script></script>`;
    const host = document.getElementById("host") as Element;
    const ids = overlayElements(document, host).map((e) => e.id || e.tagName.toLowerCase());
    expect(ids).toEqual(["menu", "li"]);
  });

  it("measures zero-size wrappers by their children and detects overlap", () => {
    document.body.innerHTML = `<div id="root"></div><div id="dialog"><div id="overlay"></div></div>`;
    const wrapper = document.getElementById("dialog") as Element;
    place(wrapper, { x: 0, y: 0, width: 0, height: 0 });
    place(document.getElementById("overlay") as Element, { x: 0, y: 0, width: 1600, height: 900 });
    const rects = overlayRects([wrapper]);
    expect(rects).toHaveLength(1);
    const view = { x: 1100, y: 80, width: 500, height: 820 };
    expect(isOccluded(view, rects)).toBe(true);
    expect(isOccluded(view, [{ x: 0, y: 0, width: 1100, height: 900 }])).toBe(false);
    expect(isOccluded(view, [{ x: 1099, y: 0, width: 2, height: 81 }])).toBe(true);
  });

  it("sends bounds with fractions and re-places on a zoom change", () => {
    const box = { x: 880.456, y: 65.6, width: 399.555, height: 734.4 };
    expect(toNativeBounds(box)).toEqual({ x: 880.46, y: 65.6, width: 399.56, height: 734.4 });
    expect(placementKey(box, 1)).not.toBe(placementKey(box, 1.25));
  });

  it("asks the server for native views only from the desktop window", () => {
    expect(browserSocketQuery("s1", { native: true })).toBe("sessionId=s1&native=1");
    expect(browserSocketQuery("s1")).toBe("sessionId=s1");
  });

  it("forwards exactly the app shortcuts that use Ctrl/Cmd or Alt", () => {
    const withModifier = SHORTCUTS.map((s) => s.combo).filter((c) => /^(mod|alt)\+/.test(c));
    expect([...NATIVE_BROWSER_APP_SHORTCUTS].sort()).toEqual(withModifier.sort());
  });
});

describe("the desktop platform's native browser", () => {
  it("is offered only by an app that has it, and replays its shortcuts on the window", () => {
    const listeners: Array<(s: NativeBrowserShortcut) => void> = [];
    const api = {
      info: async () => ({}),
      onNotificationClick: () => () => {},
      onNavigate: () => () => {},
      browser: {
        show: vi.fn(),
        hide: vi.fn(),
        capture: async () => null,
        inspect: vi.fn(),
        onShortcut: (l: (s: NativeBrowserShortcut) => void) => {
          listeners.push(l);
          return () => {};
        },
      },
    } as unknown as CodedenDesktopApi;
    const p = selectPlatform({ codedenDesktop: api });
    expect(p.capabilities.nativeBrowser).toBe(true);
    expect(p.nativeBrowser).toBe(api.browser);
    const older = selectPlatform({ codedenDesktop: { ...api, browser: undefined } });
    expect(older.capabilities.nativeBrowser).toBe(false);
    expect(selectPlatform({}).nativeBrowser).toBeNull();

    const seen: string[] = [];
    const onKey = (e: KeyboardEvent) => seen.push(`${e.ctrlKey ? "ctrl+" : ""}${e.key}`);
    window.addEventListener("keydown", onKey);
    for (const l of listeners) {
      l({ key: "k", code: "KeyK", ctrlKey: true, metaKey: false, altKey: false, shiftKey: false });
    }
    window.removeEventListener("keydown", onKey);
    expect(seen).toEqual(["ctrl+k"]);
  });
});

describe("the native view's place in the panel", () => {
  let frames: FrameRequestCallback[] = [];
  const flush = async () => {
    await act(async () => {
      const due = frames;
      frames = [];
      for (const f of due) f(0);
      await new Promise((r) => setTimeout(r, 0));
    });
  };
  let api: {
    show: ReturnType<typeof vi.fn>;
    hide: ReturnType<typeof vi.fn>;
    capture: ReturnType<typeof vi.fn>;
    inspect: ReturnType<typeof vi.fn>;
    onShortcut: () => () => void;
  };

  beforeEach(() => {
    frames = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    (HTMLElement.prototype as { checkVisibility?: () => boolean }).checkVisibility = () => true;
    api = {
      show: vi.fn(),
      hide: vi.fn(),
      capture: vi.fn(async () => "data:image/jpeg;base64,AAAA"),
      inspect: vi.fn(),
      onShortcut: () => () => {},
    };
    bridge.current = api as unknown as CodedenDesktopBrowserApi;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    bridge.current = null;
    document.body.innerHTML = "";
  });

  it("follows the panel, hides under a menu with a still in its place, and hides on unmount", async () => {
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);
    const view = render(<NativeBrowserView sessionId="s1" title="App" />, { container: root });
    const host = view.getByTestId("native-browser-view");
    place(host, { x: 1100, y: 80, width: 500, height: 820 });
    await flush();
    expect(api.show).toHaveBeenLastCalledWith("s1", { x: 1100, y: 80, width: 500, height: 820 });

    // A resize (a sidebar toggle, a panel drag): placed again; an unchanged frame sends nothing.
    place(host, { x: 900, y: 80, width: 700, height: 820 });
    await flush();
    await flush();
    expect(api.show).toHaveBeenCalledTimes(2);
    expect(api.show).toHaveBeenLastCalledWith("s1", { x: 900, y: 80, width: 700, height: 820 });

    // A dropdown opens over the page: capture, show the still, then hide the view.
    const menu = document.createElement("div");
    document.body.append(menu);
    place(menu, { x: 1400, y: 60, width: 200, height: 160 });
    await flush();
    await flush();
    await flush();
    expect(api.capture).toHaveBeenCalledWith("s1");
    expect(api.hide).toHaveBeenCalledWith("s1");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");

    // The menu closes: the view comes back at the same place.
    menu.remove();
    await flush();
    expect(api.show).toHaveBeenCalledTimes(3);

    view.unmount();
    expect(api.hide).toHaveBeenCalledTimes(2);
  });

  it("hides while the panel has no size (another tab, a closed panel)", async () => {
    const view = render(<NativeBrowserView sessionId="s2" title="App" />);
    const host = view.getByTestId("native-browser-view");
    place(host, { x: 0, y: 0, width: 0, height: 0 });
    await flush();
    expect(api.show).not.toHaveBeenCalled();
    place(host, { x: 10, y: 10, width: 300, height: 300 });
    await flush();
    expect(api.show).toHaveBeenCalledTimes(1);
    place(host, { x: 10, y: 10, width: 0, height: 300 });
    await flush();
    expect(api.hide).toHaveBeenCalledWith("s2");
    view.unmount();
  });
});
