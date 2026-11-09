import { useState } from "react";
import { CHECK_STATES, type CheckState, type CheckTone } from "@/lib/github-checks";
import { cn } from "@/lib/utils";

const toneClass: Record<CheckTone, string> = {
  running: "text-status-running",
  waiting: "text-status-waiting",
  done: "text-status-done",
  failed: "text-status-failed",
  muted: "text-muted-foreground/70",
};

export function checkToneClass(state: CheckState): string {
  return toneClass[CHECK_STATES[state].tone];
}

/**
 * True from the render where `state` goes from an active state (running, queued) to a finished
 * one. Computed during render, so the finishing animation starts on the same frame as the new
 * glyph. A first render or an unchanged refetch never animates.
 */
function useJustFinished(state: CheckState | null): boolean {
  const [prev, setPrev] = useState(state);
  const [finished, setFinished] = useState(false);
  if (prev !== state) {
    setPrev(state);
    setFinished(
      prev !== null && CHECK_STATES[prev].active && state !== null && !CHECK_STATES[state].active,
    );
  }
  return finished;
}

const stroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

/** Faint filled disc behind a finished result. */
function Disc() {
  return <circle cx={8} cy={8} r={7} fill="currentColor" fillOpacity={0.16} />;
}

/** Thin outline ring for muted and in-progress states. */
function Ring({ opacity = 1 }: { opacity?: number }) {
  return <circle cx={8} cy={8} r={6.25} {...stroke} strokeWidth={1.4} strokeOpacity={opacity} />;
}

function Glyph({ state, finished }: { state: CheckState | null; finished: boolean }) {
  switch (state) {
    case null:
      return <Ring opacity={0.6} />;
    case "running":
      return (
        <>
          <Ring opacity={0.22} />
          <circle
            cx={8}
            cy={8}
            r={6.25}
            {...stroke}
            strokeWidth={1.6}
            pathLength={100}
            strokeDasharray="30 70"
          />
        </>
      );
    case "queued":
      return (
        <>
          <Ring opacity={0.45} />
          <circle
            cx={8}
            cy={8}
            r={2}
            fill="currentColor"
            className="origin-center [transform-box:fill-box] motion-safe:animate-check-breathe"
          />
        </>
      );
    case "passed":
      return (
        <>
          <Disc />
          <path
            d="M5 8.25 7.1 10.3 11 6.1"
            {...stroke}
            strokeWidth={1.75}
            pathLength={1}
            className={cn(finished && "motion-safe:animate-check-draw")}
          />
        </>
      );
    case "failed":
      return (
        <>
          <Disc />
          <path d="M5.75 5.75 10.25 10.25M10.25 5.75 5.75 10.25" {...stroke} strokeWidth={1.75} />
        </>
      );
    case "timed_out":
      return (
        <>
          <Disc />
          <path d="M8 4.75V8l2.1 1.4" {...stroke} />
        </>
      );
    case "action_required":
      return (
        <>
          <Disc />
          <path d="M8 4.6v4" {...stroke} strokeWidth={1.75} />
          <circle cx={8} cy={11.1} r={0.95} fill="currentColor" />
        </>
      );
    case "cancelled":
      return (
        <>
          <Ring />
          <path d="M3.6 12.4 12.4 3.6" {...stroke} strokeWidth={1.4} />
        </>
      );
    case "stale":
      return (
        <>
          <Ring />
          <path d="M8 5.25V8l1.75 1.1" {...stroke} strokeWidth={1.4} />
        </>
      );
    default:
      // skipped, neutral
      return (
        <>
          <Ring />
          <path d="M5.5 8h5" {...stroke} strokeWidth={1.4} />
        </>
      );
  }
}

/**
 * The icon for one check (or a PR's checks): a spinning arc while running, a softly breathing
 * dot while queued, and a tick, cross or dash once finished. When a check finishes while it's
 * on screen, the tick draws in and the badge pops (a cross shakes). Under reduced motion every
 * icon is still.
 */
export function CheckGlyph({
  state,
  className,
  title,
}: {
  state: CheckState | null;
  className?: string;
  title?: string;
}) {
  const finished = useJustFinished(state);
  return (
    <svg
      viewBox="0 0 16 16"
      role="img"
      aria-label={title ?? (state ? CHECK_STATES[state].label : "No checks")}
      data-check-state={state ?? "none"}
      data-finished={finished || undefined}
      className={cn(
        "size-3.5 shrink-0",
        state ? checkToneClass(state) : "text-muted-foreground/60",
        state === "running" && "motion-safe:animate-spin",
        finished && state === "failed" && "motion-safe:animate-check-shake",
        finished && state !== "failed" && "motion-safe:animate-check-pop",
        className,
      )}
    >
      {title && <title>{title}</title>}
      <Glyph state={state} finished={finished} />
    </svg>
  );
}
