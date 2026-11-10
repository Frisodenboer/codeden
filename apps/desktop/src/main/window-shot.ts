import { type BrowserWindow, desktopCapturer, screen } from "electron";

/**
 * A PNG (base64) of the window as the OS composes it, native browser views included (a page
 * screenshot only shows the CodeDen UI underneath them). For the desktop smoke test's
 * screenshots; null when the window can't be captured.
 */
export async function windowShot(win: BrowserWindow): Promise<string | null> {
  if (win.isDestroyed()) return null;
  const bounds = win.getBounds();
  const scale = screen.getDisplayMatching(bounds).scaleFactor;
  const sources = await desktopCapturer.getSources({
    types: ["window"],
    thumbnailSize: {
      width: Math.round(bounds.width * scale),
      height: Math.round(bounds.height * scale),
    },
    fetchWindowIcons: false,
  });
  const id = win.getMediaSourceId();
  const source = sources.find((s) => s.id === id);
  return source && !source.thumbnail.isEmpty() ? source.thumbnail.toPNG().toString("base64") : null;
}
