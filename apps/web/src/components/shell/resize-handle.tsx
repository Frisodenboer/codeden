import { type PointerEvent as ReactPointerEvent, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A 1px divider with a wide invisible grab area. Drag to resize, double-click to reset.
 * `direction` is +1 when dragging right/down grows the panel, -1 when it shrinks it.
 */
export function ResizeHandle({
  orientation = "vertical",
  value,
  direction,
  onResize,
  onReset,
  label,
  className,
}: {
  orientation?: "vertical" | "horizontal";
  value: number;
  direction: 1 | -1;
  onResize: (next: number) => void;
  onReset?: () => void;
  label: string;
  className?: string;
}) {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const vertical = orientation === "vertical";

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { pos: vertical ? e.clientX : e.clientY, value };
    document.body.style.cursor = vertical ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    const delta = (vertical ? e.clientX : e.clientY) - start.current.pos;
    onResize(start.current.value + delta * direction);
  };
  const end = () => {
    start.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable separator needs pointer handlers on a div.
    <div
      role="separator"
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      tabIndex={-1}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      className={cn(
        "group relative z-10 shrink-0 bg-border transition-colors",
        vertical ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
        className,
      )}
    >
      <div
        className={cn(
          "absolute transition-colors group-hover:bg-primary/40 group-active:bg-primary/70",
          vertical ? "inset-y-0 -left-[1.5px] w-[3px]" : "inset-x-0 -top-[1.5px] h-[3px]",
        )}
      />
      <div
        className={cn("absolute", vertical ? "inset-y-0 -left-1.5 w-3" : "inset-x-0 -top-1.5 h-3")}
      />
    </div>
  );
}
