import { cn } from "@/lib/utils";

/** Rising bars: how hard the model thinks. `level` of `of` bars are filled. */
export function EffortGlyph({
  level,
  of,
  className,
}: {
  level: number;
  of: number;
  className?: string;
}) {
  return (
    <span className={cn("flex h-3 shrink-0 items-end gap-[2px]", className)} aria-hidden>
      {Array.from({ length: of }, (_, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: bars are positional.
          key={i}
          className={cn(
            "w-[3px] rounded-[1px]",
            i < level ? "bg-primary" : "bg-muted-foreground/30",
          )}
          style={{ height: `${4 + (i * 8) / Math.max(1, of - 1)}px` }}
        />
      ))}
    </span>
  );
}
