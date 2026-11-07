import type { BrowserInput } from "@codeden/contracts";
import { Loader2 } from "lucide-react";
import {
  type KeyboardEvent,
  type MouseEvent,
  useEffect,
  useRef,
  useState,
  type WheelEvent,
} from "react";
import { type FrameBox, keyInput, mouseInput } from "@/lib/browser-input";
import { cn } from "@/lib/utils";
import type { FrameMessage } from "./use-session-browser";

/**
 * Draws screencast frames on a canvas (§12.2). With `interactive`, mouse, wheel, keyboard and
 * paste go to the page: coordinates are mapped from the canvas box into frame pixels.
 */
export function BrowserCanvas({
  onFrame,
  interactive,
  onInput,
  title,
}: {
  onFrame: (listener: (f: FrameMessage) => void) => () => void;
  interactive: boolean;
  onInput: (input: BrowserInput) => void;
  title: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef({ width: 0, height: 0 });
  const [hasFrame, setHasFrame] = useState(false);
  const lastMove = useRef(0);

  useEffect(() => {
    let decoding = false;
    let pending: FrameMessage | null = null;
    let disposed = false;
    const draw = (frame: FrameMessage) => {
      decoding = true;
      const img = new Image();
      img.onload = () => {
        const el = canvas.current;
        const ctx = el?.getContext("2d");
        if (el && ctx && !disposed) {
          if (el.width !== frame.width) el.width = frame.width;
          if (el.height !== frame.height) el.height = frame.height;
          ctx.drawImage(img, 0, 0, frame.width, frame.height);
          size.current = { width: frame.width, height: frame.height };
          setHasFrame(true);
        }
        next();
      };
      img.onerror = next;
      img.src = `data:${frame.mediaType};base64,${frame.data}`;
    };
    const next = () => {
      decoding = false;
      const queued = pending;
      pending = null;
      if (queued && !disposed) draw(queued);
    };
    const off = onFrame((frame) => {
      // Keep only the newest frame while one is decoding.
      if (decoding) pending = frame;
      else draw(frame);
    });
    return () => {
      disposed = true;
      off();
    };
  }, [onFrame]);

  const box = (el: HTMLElement): FrameBox => ({
    rect: el.getBoundingClientRect(),
    frameWidth: size.current.width || el.clientWidth,
    frameHeight: size.current.height || el.clientHeight,
  });
  const mouse =
    (type: "mouse.move" | "mouse.down" | "mouse.up") => (e: MouseEvent<HTMLCanvasElement>) => {
      if (!interactive || !hasFrame) return;
      if (type === "mouse.move") {
        const now = performance.now();
        if (now - lastMove.current < 33) return;
        lastMove.current = now;
      }
      if (type === "mouse.down") e.currentTarget.focus();
      onInput(mouseInput(type, e.nativeEvent, box(e.currentTarget)));
    };
  const wheel = (e: WheelEvent<HTMLCanvasElement>) => {
    if (!interactive || !hasFrame) return;
    onInput(mouseInput("mouse.wheel", e.nativeEvent, box(e.currentTarget)));
  };
  const key = (type: "key.down" | "key.up") => (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (!interactive) return;
    // Let the app's own paste handler deliver clipboard text.
    if (type === "key.down" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") return;
    const input = keyInput(type, e.nativeEvent);
    if (!input) return;
    e.preventDefault();
    onInput(input);
  };

  return (
    <>
      {!hasFrame && (
        <div className="absolute inset-x-0 top-24 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Waiting for the first frame…
        </div>
      )}
      <canvas
        ref={canvas}
        data-testid="browser-canvas"
        data-has-frame={hasFrame ? "1" : "0"}
        aria-label={title}
        role="img"
        tabIndex={interactive ? 0 : -1}
        onMouseMove={mouse("mouse.move")}
        onMouseDown={mouse("mouse.down")}
        onMouseUp={mouse("mouse.up")}
        onContextMenu={(e) => interactive && e.preventDefault()}
        onWheel={wheel}
        onKeyDown={key("key.down")}
        onKeyUp={key("key.up")}
        onPaste={(e) => {
          if (!interactive) return;
          const text = e.clipboardData.getData("text");
          if (text) onInput({ type: "text.insert", text });
        }}
        className={cn(
          "block h-auto max-w-full rounded-md border border-border bg-white shadow-lg outline-none",
          !hasFrame && "invisible h-0",
          interactive && "ring-2 ring-status-waiting/60",
        )}
      />
    </>
  );
}
