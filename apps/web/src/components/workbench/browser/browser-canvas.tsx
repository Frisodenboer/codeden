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
import {
  type FrameBox,
  type FrameFit,
  frameRect,
  onFrame as isOnFrame,
  keyInput,
  modifiersOf,
  mouseInput,
  wheelDeltas,
} from "@/lib/browser-input";
import { cn } from "@/lib/utils";
import type { FrameMessage } from "./use-session-browser";

interface DrawnFrame {
  width: number;
  height: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

/**
 * Draws screencast frames on a canvas that fills its container (§12.2). Mouse, wheel,
 * keyboard and paste always go to the page; pointer coordinates are mapped from where the
 * frame is drawn into frame pixels.
 *
 * `fill` stretches the frame over the whole box: the page is laid out at this panel's size,
 * so it only distorts for the moment between a resize and the first frame at the new size
 * (the last frame stays up, no blank flash). `contain` fits a frame of another size inside.
 */
export function BrowserCanvas({
  onFrame,
  onInput,
  fit,
  title,
}: {
  onFrame: (listener: (f: FrameMessage) => void) => () => void;
  onInput: (input: BrowserInput) => void;
  fit: FrameFit;
  title: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef<DrawnFrame>({ width: 0, height: 0 });
  const [hasFrame, setHasFrame] = useState(false);
  const lastMove = useRef(0);
  const wheel = useRef<{ x: number; y: number; dx: number; dy: number; box: FrameBox } | null>(
    null,
  );
  const wheelFrame = useRef(0);

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
          // Resizing the backing store clears it, so it only changes with a frame to draw.
          if (el.width !== frame.width) el.width = frame.width;
          if (el.height !== frame.height) el.height = frame.height;
          ctx.drawImage(img, 0, 0, frame.width, frame.height);
          drawn.current = {
            width: frame.width,
            height: frame.height,
            viewportWidth: frame.metadata?.deviceWidth,
            viewportHeight: frame.metadata?.deviceHeight,
          };
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

  useEffect(() => () => cancelAnimationFrame(wheelFrame.current), []);

  const box = (el: HTMLElement): FrameBox => {
    const d = drawn.current;
    const frameWidth = d.width || el.clientWidth;
    const frameHeight = d.height || el.clientHeight;
    return {
      rect: frameRect(el.getBoundingClientRect(), frameWidth, frameHeight, fit),
      frameWidth,
      frameHeight,
      viewportWidth: d.viewportWidth,
      viewportHeight: d.viewportHeight,
    };
  };
  const mouse =
    (type: "mouse.move" | "mouse.down" | "mouse.up") => (e: MouseEvent<HTMLCanvasElement>) => {
      if (!hasFrame) return;
      if (type === "mouse.move") {
        const now = performance.now();
        if (now - lastMove.current < 33) return;
        lastMove.current = now;
      }
      if (type === "mouse.down") e.currentTarget.focus();
      const b = box(e.currentTarget);
      // Presses on the letterbox around a fitted frame are not on the page.
      if (type === "mouse.down" && !isOnFrame(b.rect, e.clientX, e.clientY)) return;
      onInput(mouseInput(type, e.nativeEvent, b));
    };
  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    if (!hasFrame) return;
    const b = box(e.currentTarget);
    const { deltaX, deltaY } = wheelDeltas(e.nativeEvent, b);
    // Trackpads fire many small wheel events: send their sum once per animation frame.
    const acc = wheel.current;
    if (acc) {
      acc.dx += deltaX;
      acc.dy += deltaY;
      acc.x = e.clientX;
      acc.y = e.clientY;
      acc.box = b;
      return;
    }
    const mods = modifiersOf(e);
    wheel.current = { x: e.clientX, y: e.clientY, dx: deltaX, dy: deltaY, box: b };
    wheelFrame.current = requestAnimationFrame(() => {
      const w = wheel.current;
      wheel.current = null;
      if (!w || (w.dx === 0 && w.dy === 0)) return;
      onInput(
        mouseInput(
          "mouse.wheel",
          {
            clientX: w.x,
            clientY: w.y,
            deltaX: w.dx,
            deltaY: w.dy,
            altKey: (mods & 1) !== 0,
            ctrlKey: (mods & 2) !== 0,
            metaKey: (mods & 4) !== 0,
            shiftKey: (mods & 8) !== 0,
          },
          w.box,
        ),
      );
    });
  };
  const key = (type: "key.down" | "key.up") => (e: KeyboardEvent<HTMLCanvasElement>) => {
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
        <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Waiting for the first frame…
        </div>
      )}
      <canvas
        ref={canvas}
        data-testid="browser-canvas"
        data-has-frame={hasFrame ? "1" : "0"}
        data-fit={fit}
        aria-label={title}
        role="img"
        tabIndex={0}
        onMouseMove={mouse("mouse.move")}
        onMouseDown={mouse("mouse.down")}
        onMouseUp={mouse("mouse.up")}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={onWheel}
        onKeyDown={key("key.down")}
        onKeyUp={key("key.up")}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (text) onInput({ type: "text.insert", text });
        }}
        style={{ objectFit: fit }}
        className={cn("absolute inset-0 block size-full outline-none", !hasFrame && "invisible")}
      />
    </>
  );
}
