import { useEffect, useRef, useState } from "react";
import {
  isOccluded,
  overlayElements,
  overlayRects,
  placementKey,
  toNativeBounds,
} from "@/lib/native-browser";
import { platform } from "@/lib/platform";
import { useUiStore } from "@/stores/ui";

/** How long a capture may take before the view hides anyway (a menu must not stay under it). */
const CAPTURE_WAIT_MS = 120;
/** How long the placeholder stays after the view is back, so there is no gap in between. */
const PLACEHOLDER_LINGER_MS = 120;

/**
 * Where the desktop app lays the session's native browser view (§17 Phase 2). The element is
 * an empty box in the panel; every animation frame it measures itself and tells the app where
 * the view goes, so resizes, sidebar and panel toggles, layout animations and zoom all follow.
 *
 * A native view paints over the whole page, so the view hides whenever a menu, dialog, the
 * palette, a tooltip or a toast overlaps it, and while the panel is hidden. While hidden for an
 * overlay it shows a still of the page in its place: the menu sits on a picture of the page
 * instead of over an empty panel.
 */
export function NativeBrowserView({ sessionId, title }: { sessionId: string; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const setShown = useUiStore((s) => s.setNativeBrowserShown);

  useEffect(() => {
    const el = ref.current;
    const bridge = platform.nativeBrowser;
    if (!el || !bridge) return;
    let frame = 0;
    let disposed = false;
    /** Last placement sent: a key while shown, "" while hidden. */
    let placed = "";
    let covered = false;
    let linger: ReturnType<typeof setTimeout> | undefined;

    const hide = () => {
      if (placed !== "") bridge.hide(sessionId);
      placed = "";
    };
    const coverWithStill = async () => {
      const still = await Promise.race([
        bridge.capture(sessionId).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), CAPTURE_WAIT_MS)),
      ]);
      if (disposed || !covered) return;
      if (still) setPlaceholder(still);
      // Let the still paint first, then take the view away.
      requestAnimationFrame(() => {
        if (!disposed && covered) hide();
      });
    };

    const tick = () => {
      frame = requestAnimationFrame(tick);
      const rect = el.getBoundingClientRect();
      const visible =
        rect.width >= 2 &&
        rect.height >= 2 &&
        document.visibilityState === "visible" &&
        (el.checkVisibility?.() ?? el.offsetParent !== null);
      const overlap = visible && isOccluded(rect, overlayRects(overlayElements(document, el)));
      if (overlap !== covered) {
        covered = overlap;
        clearTimeout(linger);
        if (overlap) void coverWithStill();
        else linger = setTimeout(() => setPlaceholder(null), PLACEHOLDER_LINGER_MS);
      }
      if (!visible) return hide();
      if (covered) return;
      const key = placementKey(rect, window.devicePixelRatio || 1);
      if (key === placed) return;
      placed = key;
      bridge.show(sessionId, toNativeBounds(rect));
    };
    setShown(true);
    frame = requestAnimationFrame(tick);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      clearTimeout(linger);
      bridge.hide(sessionId);
      setShown(false);
    };
  }, [sessionId, setShown]);

  return (
    <div
      ref={ref}
      data-testid="native-browser-view"
      role="document"
      aria-label={title}
      className="absolute inset-0 bg-background"
    >
      {placeholder && (
        <img src={placeholder} alt="" className="pointer-events-none size-full select-none" />
      )}
    </div>
  );
}
