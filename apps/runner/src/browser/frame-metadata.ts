import type { BrowserFrameMetadata } from "@codeden/contracts";

/** Pixels of slack for rounding in Chromium's scaling. */
const SLACK = 2;

/**
 * Make screencast frame metadata describe the page viewport in CSS pixels on every platform.
 *
 * When `Page.startScreencast` scales frames down to its `maxWidth`/`maxHeight`, Chromium on
 * Windows and Linux still reports `deviceWidth`/`deviceHeight` as the page viewport, but on
 * macOS it reports the *scaled frame* in DIPs (frame pixels / device scale factor): a
 * 1280x800 page sent as 640x400 frames says 640x400. The page itself is laid out at full
 * size. Input mapping uses this metadata (the panel sends it back with each click), so the
 * macOS shape is corrected to the viewport the screencast was started for.
 *
 * Only that exact shape is rewritten: the frame was capped below the viewport's device pixels,
 * and the reported size times the scale factor equals the frame. Anything else (including a
 * frame of a newer layout during a resize) is passed through as reported.
 */
export function normalizeFrameMetadata(
  metadata: BrowserFrameMetadata,
  frame: { width: number; height: number },
  viewport: { width: number; height: number; deviceScaleFactor: number },
  cap: { width: number; height: number },
): BrowserFrameMetadata {
  const scale = viewport.deviceScaleFactor;
  const near = (a: number, b: number) => Math.abs(a - b) <= SLACK;
  const capped =
    (cap.width < viewport.width * scale - SLACK || cap.height < viewport.height * scale - SLACK) &&
    (frame.width >= cap.width - SLACK || frame.height >= cap.height - SLACK);
  const scaledShape =
    near(metadata.deviceWidth * scale, frame.width) &&
    near(metadata.deviceHeight * scale, frame.height) &&
    metadata.deviceWidth < viewport.width - 1;
  if (!capped || !scaledShape) return metadata;
  // Scroll offsets are passed through as reported: nothing reads them, and they aren't
  // known to be scaled the same way.
  return { ...metadata, deviceWidth: viewport.width, deviceHeight: viewport.height };
}
