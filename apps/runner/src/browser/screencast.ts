import type { BrowserFrameMetadata, RunnerStream } from "@codeden/contracts";
import type { CDPSession } from "playwright-core";
import { jpegSize } from "./images";

export interface ScreencastSettings {
  /** JPEG quality, 10-100. */
  quality: number;
  maxWidth: number;
  maxHeight: number;
  /** Upper bound on frames per second (acks are delayed to enforce it). */
  maxFps: number;
}

export const DEFAULT_SCREENCAST: ScreencastSettings = {
  quality: 60,
  maxWidth: 1280,
  maxHeight: 800,
  maxFps: 15,
};

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
}

/**
 * CDP screencast of a session's active tab (§12.2). Runs only while at least one panel
 * viewer watches; follows the active tab; throttles by delaying frame acks.
 */
export class Screencast {
  private readonly viewers = new Set<string>();
  private settings: ScreencastSettings = { ...DEFAULT_SCREENCAST };
  private target: Target | undefined;
  private tab: { tabId: string; cdp: CDPSession } | undefined;
  private lastFrame: FrameStream | undefined;
  private readonly ackTimers = new Set<NodeJS.Timeout>();
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
      } else {
        this.viewers.delete(viewerId);
        if (this.viewers.size === 0) await this.stopTarget();
      }
      return this.viewers.size;
    });
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
      if (this.target?.cdp !== cdp) return ack();
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
      this.ackTimers.add(timer);
    };
    cdp.on("Page.screencastFrame", onFrame);
    this.target = { tabId, cdp, onFrame };
    await cdp
      .send("Page.startScreencast", {
        format: "jpeg",
        quality: this.settings.quality,
        maxWidth: this.settings.maxWidth,
        maxHeight: this.settings.maxHeight,
        everyNthFrame: 1,
      })
      .catch(() => {
        // The tab closed under us; the session will retarget.
        cdp.off("Page.screencastFrame", onFrame);
        if (this.target?.cdp === cdp) this.target = undefined;
      });
  }

  private async stopTarget(): Promise<void> {
    const target = this.target;
    if (!target) return;
    this.target = undefined;
    for (const timer of this.ackTimers) clearTimeout(timer);
    this.ackTimers.clear();
    target.cdp.off("Page.screencastFrame", target.onFrame);
    await target.cdp.send("Page.stopScreencast").catch(() => undefined);
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
