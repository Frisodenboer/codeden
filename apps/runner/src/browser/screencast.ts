import type { BrowserFrameMetadata, RunnerStream } from "@codeden/contracts";
import type { CDPSession } from "playwright-core";
import { jpegSize } from "./images";

export interface ScreencastSettings {
  /** JPEG quality, 10-100. */
  quality: number;
  /**
   * Optional caps on the frame size (pixels). Without them frames match the viewport's device
   * pixels (`setFrameSize`), so the panel draws them 1:1.
   */
  maxWidth?: number;
  maxHeight?: number;
  /** Upper bound on frames per second (acks are delayed to enforce it). */
  maxFps: number;
}

/**
 * 75 keeps small text crisp at device pixels (60 smeared it on HiDPI) while a full 2x frame
 * stays around 60-150 KB; 20 fps is smooth enough for scrolling and frames only come on change.
 */
export const DEFAULT_SCREENCAST: ScreencastSettings = {
  quality: 75,
  maxFps: 20,
};

/** Frame size before the first viewport is applied (the default 1280x800 at 1x). */
const DEFAULT_FRAME = { width: 1280, height: 800 };

export type FrameStream = Extract<RunnerStream, { kind: "browser.frame" }>;

interface ScreencastFrameEvent {
  data: string;
  sessionId: number;
  metadata: BrowserFrameMetadata;
}

interface Target {
  tabId: string;
  cdp: CDPSession;
  onFrame: (event: ScreencastFrameEvent) => void;
  /** Frames Chromium sent for this (re)start. */
  frames: number;
  stillTimer?: NodeJS.Timeout;
}

/**
 * Chromium only sends screencast frames when the page changes. If a (re)started screencast
 * has sent nothing after this long, a still is captured so viewers never wait on a still page.
 */
export const STILL_FRAME_MS = 1_000;

interface LayoutMetrics {
  cssVisualViewport?: { pageX: number; pageY: number; scale?: number };
}

/**
 * CDP screencast of a session's active tab (§12.2). Runs only while at least one panel
 * viewer watches; follows the active tab; throttles by delaying frame acks.
 */
export class Screencast {
  private readonly viewers = new Set<string>();
  private settings: ScreencastSettings = { ...DEFAULT_SCREENCAST };
  private frameSize = { ...DEFAULT_FRAME };
  /** The page viewport in CSS pixels (metadata for still frames). */
  private viewportCss = { ...DEFAULT_FRAME };
  private target: Target | undefined;
  private tab: { tabId: string; cdp: CDPSession } | undefined;
  private lastFrame: FrameStream | undefined;
  /** Delayed acks (the fps throttle), so a stop can send them instead of dropping them. */
  private readonly ackTimers = new Map<NodeJS.Timeout, () => void>();
  private queue: Promise<void> = Promise.resolve();
  /** Total frames emitted (diagnostics and tests). */
  frames = 0;

  constructor(
    private readonly sessionId: string,
    private readonly emit: (frame: FrameStream) => void,
  ) {}

  get viewerCount(): number {
    return this.viewers.size;
  }

  get running(): boolean {
    return this.target !== undefined;
  }

  /** Geometry of the latest frame, for mapping panel input. */
  get metadata(): BrowserFrameMetadata | undefined {
    return this.lastFrame?.metadata;
  }

  /** Add or remove a viewer; starts on the first and pauses after the last. */
  watch(
    viewerId: string,
    watching: boolean,
    settings: Partial<ScreencastSettings> = {},
  ): Promise<number> {
    return this.serial(async () => {
      if (watching) {
        const changed = Object.entries(settings).some(
          ([k, v]) => v !== undefined && this.settings[k as keyof ScreencastSettings] !== v,
        );
        this.settings = { ...this.settings, ...definedOnly(settings) };
        this.viewers.add(viewerId);
        if (changed && this.target) await this.stopTarget();
        if (!this.target) await this.startTarget();
        // Chromium only sends frames on change: give the new viewer the current picture.
        else if (this.lastFrame) this.emit(this.lastFrame);
        else await this.stillFrame(this.target, true);
      } else {
        this.viewers.delete(viewerId);
        if (this.viewers.size === 0) await this.stopTarget();
      }
      return this.viewers.size;
    });
  }

  /**
   * Frame size in pixels (the viewport's device pixels). A running screencast restarts with
   * the new size; the last frame stays valid for the panel to stretch until new ones arrive.
   */
  setFrameSize(
    size: { width: number; height: number },
    viewportCss?: { width: number; height: number },
  ): Promise<void> {
    return this.serial(async () => {
      if (viewportCss) this.viewportCss = { width: viewportCss.width, height: viewportCss.height };
      if (size.width === this.frameSize.width && size.height === this.frameSize.height) return;
      this.frameSize = { width: size.width, height: size.height };
      if (!this.target) return;
      await this.stopTarget();
      await this.startTarget();
    });
  }

  /** `Page.startScreencast` parameters for the current settings and frame size. */
  get startParams(): Record<string, unknown> {
    const cap = (value: number, max: number | undefined) =>
      Math.max(1, Math.round(max === undefined ? value : Math.min(value, max)));
    return {
      format: "jpeg",
      quality: this.settings.quality,
      maxWidth: cap(this.frameSize.width, this.settings.maxWidth),
      maxHeight: cap(this.frameSize.height, this.settings.maxHeight),
      everyNthFrame: 1,
    };
  }

  /** Follow a (new) active tab; `undefined` when the session has no tabs. */
  setTab(tab: { tabId: string; cdp: CDPSession } | undefined): Promise<void> {
    return this.serial(async () => {
      if (this.tab?.tabId === tab?.tabId && this.tab?.cdp === tab?.cdp) return;
      await this.stopTarget();
      this.tab = tab;
      this.lastFrame = undefined;
      if (this.viewers.size > 0) await this.startTarget();
    });
  }

  dispose(): Promise<void> {
    return this.serial(async () => {
      this.viewers.clear();
      await this.stopTarget();
      this.tab = undefined;
    });
  }

  /** Run state changes one at a time (tab switches and viewer changes can overlap). */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private async startTarget(): Promise<void> {
    const tab = this.tab;
    if (!tab) return;
    const { cdp, tabId } = tab;
    const interval = Math.round(1000 / this.settings.maxFps);
    const onFrame = (event: ScreencastFrameEvent) => {
      const ack = () => {
        cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
      };
      if (this.target !== target) return ack();
      target.frames++;
      const size = jpegSize(Buffer.from(event.data.slice(0, 64 * 1024), "base64")) ?? {
        width: Math.max(1, Math.round(event.metadata.deviceWidth)),
        height: Math.max(1, Math.round(event.metadata.deviceHeight)),
      };
      const frame: FrameStream = {
        kind: "browser.frame",
        sessionId: this.sessionId,
        tabId,
        mediaType: "image/jpeg",
        data: event.data,
        width: size.width,
        height: size.height,
        metadata: pickMetadata(event.metadata),
      };
      this.lastFrame = frame;
      this.frames++;
      this.emit(frame);
      const timer = setTimeout(() => {
        this.ackTimers.delete(timer);
        ack();
      }, interval);
      this.ackTimers.set(timer, ack);
    };
    const target: Target = { tabId, cdp, onFrame, frames: 0 };
    cdp.on("Page.screencastFrame", onFrame);
    this.target = target;
    const started = await cdp.send("Page.startScreencast", this.startParams as never).then(
      () => true,
      () => {
        // The tab closed under us; the session will retarget.
        cdp.off("Page.screencastFrame", onFrame);
        if (this.target === target) this.target = undefined;
        return false;
      },
    );
    if (!started) return;
    target.stillTimer = setTimeout(() => {
      void this.serial(() => this.stillFrame(target, false));
    }, STILL_FRAME_MS);
    target.stillTimer.unref?.();
  }

  /**
   * Capture the page as a frame when Chromium has sent none (a still page after a restart, or
   * a viewer that needs a picture before any frame came). `force` skips the frame check.
   */
  private async stillFrame(target: Target, force: boolean): Promise<void> {
    if (this.target !== target || (!force && target.frames > 0)) return;
    const { cdp, tabId } = target;
    try {
      const [shot, metrics] = await Promise.all([
        cdp.send("Page.captureScreenshot", {
          format: "jpeg",
          quality: this.settings.quality,
        }) as Promise<{ data: string }>,
        cdp.send("Page.getLayoutMetrics") as Promise<LayoutMetrics>,
      ]);
      // A real frame (or a restart) won the race: it is newer than this still.
      if (this.target !== target || (!force && target.frames > 0)) return;
      const size = jpegSize(Buffer.from(shot.data.slice(0, 64 * 1024), "base64"));
      if (!size) return;
      const view = metrics.cssVisualViewport;
      const frame: FrameStream = {
        kind: "browser.frame",
        sessionId: this.sessionId,
        tabId,
        mediaType: "image/jpeg",
        data: shot.data,
        width: size.width,
        height: size.height,
        metadata: {
          deviceWidth: this.viewportCss.width,
          deviceHeight: this.viewportCss.height,
          pageScaleFactor: view?.scale ?? 1,
          offsetTop: 0,
          scrollOffsetX: view?.pageX ?? 0,
          scrollOffsetY: view?.pageY ?? 0,
        },
      };
      this.lastFrame = frame;
      this.frames++;
      this.emit(frame);
    } catch {
      // The tab is closing; the session retargets.
    }
  }

  private async stopTarget(): Promise<void> {
    const target = this.target;
    if (!target) return;
    this.target = undefined;
    clearTimeout(target.stillTimer);
    // Ack what is still held back: unacked frames count as in flight, and a restarted
    // screencast (resize, settings) would otherwise send nothing on a still page.
    for (const [timer, ack] of this.ackTimers) {
      clearTimeout(timer);
      ack();
    }
    this.ackTimers.clear();
    await target.cdp.send("Page.stopScreencast").catch(() => undefined);
    // Detach after stopping: frames that raced the stop are still acked (target is unset).
    target.cdp.off("Page.screencastFrame", target.onFrame);
  }
}

function definedOnly(settings: Partial<ScreencastSettings>): Partial<ScreencastSettings> {
  return Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== undefined));
}

function pickMetadata(m: BrowserFrameMetadata): BrowserFrameMetadata {
  return {
    ...(m.timestamp !== undefined ? { timestamp: m.timestamp } : {}),
    deviceWidth: m.deviceWidth,
    deviceHeight: m.deviceHeight,
    pageScaleFactor: m.pageScaleFactor,
    offsetTop: m.offsetTop,
    scrollOffsetX: m.scrollOffsetX,
    scrollOffsetY: m.scrollOffsetY,
  };
}
