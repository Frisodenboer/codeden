import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useTranscriptsStore } from "@/stores/transcripts";

const compact = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1)}M`
    : n >= 1_000
      ? `${Math.round(n / 1_000)}k`
      : String(n);

/**
 * How full the session's context window is, next to the model in the composer: a small ring and
 * a percentage, the token counts on hover. Shows only the tokens when the provider doesn't say
 * how big the window is, and nothing before the first turn.
 */
export function ContextMeter({ sessionId }: { sessionId: string }) {
  const usage = useTranscriptsStore((s) => s.byId[sessionId]?.usage ?? null);
  const used = usage?.contextTokens;
  if (!used) return null;
  const window = usage?.contextWindow;
  const pct = window ? Math.min(100, (used / window) * 100) : null;
  const tone =
    pct === null
      ? "text-muted-foreground"
      : pct >= 85
        ? "text-status-failed"
        : pct >= 65
          ? "text-status-waiting"
          : "text-muted-foreground";
  // A ring: r=6, circumference ≈ 37.7.
  const circumference = 2 * Math.PI * 6;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn("flex h-7 items-center gap-1 rounded-md px-1.5 text-xs tabular-nums", tone)}
          role="img"
          aria-label={
            pct === null
              ? `${compact(used)} tokens in context`
              : `Context ${Math.round(pct)}% full: ${compact(used)} of ${compact(window ?? 0)} tokens`
          }
        >
          <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden>
            <circle
              cx="8"
              cy="8"
              r="6"
              fill="none"
              stroke="currentColor"
              strokeOpacity="0.25"
              strokeWidth="2.5"
            />
            {pct !== null && (
              <circle
                cx="8"
                cy="8"
                r="6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * circumference} ${circumference}`}
              />
            )}
          </svg>
          {pct === null ? compact(used) : `${Math.round(pct)}%`}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {pct === null
          ? `${used.toLocaleString()} tokens in context`
          : `Context: ${used.toLocaleString()} of ${(window ?? 0).toLocaleString()} tokens (${Math.round(pct)}%). Claude compacts automatically when it gets full; /compact does it now.`}
      </TooltipContent>
    </Tooltip>
  );
}
