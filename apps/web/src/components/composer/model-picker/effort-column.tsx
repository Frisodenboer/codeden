import type { ReasoningEffort } from "@codeden/contracts";
import { Check } from "lucide-react";
import type { KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { EffortGlyph } from "./effort-glyph";
import { EFFORT_NAME } from "./logic";

const ROW =
  "flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none hover:bg-accent focus-visible:bg-accent";

/** Up and Down move between levels; Left goes back to the search box. */
function onColumnKeyDown(e: KeyboardEvent<HTMLDivElement>, onBack: () => void) {
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.key === "ArrowLeft") {
    e.preventDefault();
    onBack();
    return;
  }
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("[data-effort]"));
  const index = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    e.key === "Home"
      ? rows[0]
      : e.key === "End"
        ? rows.at(-1)
        : rows[Math.min(rows.length - 1, Math.max(0, index + (e.key === "ArrowDown" ? 1 : -1)))];
  if (!next) return;
  e.preventDefault();
  next.focus();
}

/**
 * The selected model's effort levels, docked beside the model list. Lists nothing but a note
 * when the model has no levels, so switching models never resizes the popover.
 */
export function EffortColumn({
  modelLabel,
  missing,
  levels,
  value,
  defaultEffort,
  onPick,
  onBack,
}: {
  modelLabel: string;
  /** The chosen model is no longer in the provider's list. */
  missing?: boolean;
  levels: ReasoningEffort[];
  /** The effort that will run (already resolved against the model's default). */
  value: ReasoningEffort | null;
  defaultEffort?: ReasoningEffort;
  onPick: (effort: ReasoningEffort) => void;
  onBack: () => void;
}) {
  return (
    <div
      data-picker-effort
      className="flex min-h-0 w-44 shrink-0 flex-col border-l border-border bg-muted/30 max-sm:h-48 max-sm:w-full max-sm:border-t max-sm:border-l-0"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <span className="font-medium text-muted-foreground">Effort</span>
        <span className="ml-auto min-w-0 truncate text-2xs text-muted-foreground/80">
          {modelLabel}
        </span>
      </div>
      {levels.length === 0 ? (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">
          {missing
            ? "This model isn't in the provider's list any more. Pick another to set its effort."
            : "This model has no effort levels."}
        </p>
      ) : (
        <div
          role="radiogroup"
          aria-label="Reasoning effort"
          className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5"
          onKeyDown={(e) => onColumnKeyDown(e, onBack)}
        >
          {levels.map((level, i) => {
            const selected = level === value;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a row button with roving focus; picking it also closes the picker.
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={selected}
                data-effort={level}
                tabIndex={selected || (value === null && i === 0) ? 0 : -1}
                className={cn(ROW, selected && "text-foreground")}
                onClick={() => onPick(level)}
              >
                <EffortGlyph level={i + 1} of={levels.length} />
                <span className="min-w-0 flex-1 truncate">{EFFORT_NAME[level]}</span>
                {level === defaultEffort && !selected && (
                  <span className="text-2xs text-muted-foreground/80">Default</span>
                )}
                {selected && <Check className="size-3.5" aria-hidden />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Focus the checked level (or the first) inside a picker popover. */
export function focusEffort(root: HTMLElement | null): boolean {
  const column = root?.querySelector("[data-picker-effort]");
  const row =
    column?.querySelector<HTMLElement>('[data-effort][aria-checked="true"]') ??
    column?.querySelector<HTMLElement>("[data-effort]");
  row?.focus();
  return Boolean(row);
}
