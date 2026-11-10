import { useEffect, useRef, useState } from "react";
import type { BrowserChannel } from "@/lib/api/feature-apis";
import { VIEWPORTS } from "@/lib/browser-input";
import {
  createViewportReporter,
  panelViewport,
  type ViewportReporter,
} from "@/lib/browser-viewport";

/** `fit`: the page follows the panel's size. A preset id: a fixed device size. */
export type ViewportMode = "fit" | (typeof VIEWPORTS)[number]["id"];

/**
 * Sizes the session's page to this panel (§12.2): measures the element it is attached to
 * with a `ResizeObserver` (and on `devicePixelRatio` changes) and reports its content box over
 * the viewer socket, debounced. The viewer claims the viewport, taking it over from other
 * viewers, when its window gains focus, when the panel is pressed, and when a size is picked.
 * Returns the ref callback for the element to measure.
 */
export function usePanelViewport(
  channel: BrowserChannel | null,
  mode: ViewportMode,
  mine: boolean | undefined,
): (el: HTMLElement | null) => void {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [reporter, setReporter] = useState<ViewportReporter | null>(null);
  const mineRef = useRef(mine);
  mineRef.current = mine;
  const lastMode = useRef(mode);

  useEffect(() => {
    if (!channel) return;
    const r = createViewportReporter((size, claim) => channel.viewport(size, claim));
    setReporter(r);
    return () => {
      r.dispose();
      setReporter((current) => (current === r ? null : current));
    };
  }, [channel]);

  useEffect(() => {
    const r = reporter;
    if (!el || !r) return;
    const measure = () => {
      const dpr = window.devicePixelRatio || 1;
      const preset = VIEWPORTS.find((v) => v.id === mode);
      if (preset) return r.measure(panelViewport(preset.width, preset.height, dpr));
      // Hidden (display: none) panels measure 0: keep the last size.
      if (el.clientWidth < 2 || el.clientHeight < 2) return;
      r.measure(panelViewport(el.clientWidth, el.clientHeight, dpr));
    };
    measure();
    if (lastMode.current !== mode) {
      lastMode.current = mode;
      r.claim();
    }

    const observer = new ResizeObserver(measure);
    observer.observe(el);

    // Moving to another screen or zooming changes the pixel ratio without a resize.
    let query: MediaQueryList | null = null;
    const onRatio = () => {
      watchRatio();
      measure();
    };
    const watchRatio = () => {
      query?.removeEventListener("change", onRatio);
      query = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`) ?? null;
      query?.addEventListener("change", onRatio);
    };
    watchRatio();

    const claim = () => {
      if (!mineRef.current) r.claim();
    };
    window.addEventListener("focus", claim);
    el.addEventListener("pointerdown", claim, true);
    return () => {
      observer.disconnect();
      query?.removeEventListener("change", onRatio);
      window.removeEventListener("focus", claim);
      el.removeEventListener("pointerdown", claim, true);
    };
  }, [el, mode, reporter]);

  return setEl;
}
