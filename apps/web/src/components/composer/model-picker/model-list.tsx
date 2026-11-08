import { Command as CommandPrimitive } from "cmdk";
import { ArrowRight, Check, Search, Star, TriangleAlert } from "lucide-react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { ProviderMark } from "@/components/common/bits";
import { cn } from "@/lib/utils";
import type { Availability, ModelRow } from "./logic";

/**
 * Shown above the models of a provider that isn't set up on this machine. The models stay
 * pickable: detection can lag, and a session may already run on that provider.
 */
export function SetupNotice({
  name,
  availability,
  onOpenSetup,
}: {
  name: string;
  availability: Availability;
  onOpenSetup: () => void;
}) {
  return (
    <div
      className="mb-1.5 flex flex-col items-start gap-1 rounded-md border border-status-waiting/25 bg-status-waiting/[0.06] px-2.5 py-2 text-xs"
      data-picker-notice
    >
      <p className="flex items-center gap-1.5 font-medium text-foreground">
        <TriangleAlert className="size-3.5 text-status-waiting" aria-hidden />
        {name}: {availability.reason}
      </p>
      {availability.detail && <p className="text-muted-foreground">{availability.detail}</p>}
      {availability.command && (
        <p className="text-muted-foreground">
          Run <code className="rounded bg-muted px-1 py-0.5 font-mono">{availability.command}</code>{" "}
          in a terminal, then check again.
        </p>
      )}
      <button
        type="button"
        onClick={onOpenSetup}
        className="mt-1 inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-medium text-primary outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        Open setup <ArrowRight className="size-3" aria-hidden />
      </button>
    </div>
  );
}

function Row({
  row,
  selected,
  highlighted,
  favorite,
  onPick,
  onToggleFavorite,
}: {
  row: ModelRow;
  selected: boolean;
  highlighted: boolean;
  favorite: boolean;
  onPick: (row: ModelRow) => void;
  onToggleFavorite?: (row: ModelRow) => void;
}) {
  const { model, provider } = row;
  return (
    <CommandPrimitive.Item
      value={row.key}
      onSelect={() => onPick(row)}
      title={model.description ? `${model.label}: ${model.description}` : model.label}
      data-checked={selected}
      className="group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] outline-none select-none data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
    >
      <ProviderMark provider={provider.id} />
      <span className="shrink-0 truncate">
        {model.label}
        <span className="sr-only">, {provider.displayName}</span>
      </span>
      {model.isDefault && provider.models.length > 1 && (
        <span className="shrink-0 rounded border border-border px-1 text-3xs text-muted-foreground">
          Default
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
        {model.description}
      </span>
      {onToggleFavorite && (
        <button
          type="button"
          // Only the highlighted row's star is in the tab order.
          tabIndex={highlighted ? 0 : -1}
          aria-pressed={favorite}
          aria-label={
            favorite ? `Remove ${model.label} from favourites` : `Add ${model.label} to favourites`
          }
          title={favorite ? "Remove from favourites" : "Add to favourites"}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(row);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
            !favorite &&
              "opacity-0 group-hover:opacity-100 group-data-[selected=true]:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100",
          )}
        >
          <Star
            className={cn("size-3", favorite && "fill-current text-status-waiting")}
            aria-hidden
          />
        </button>
      )}
      <Check className={cn("size-3.5 shrink-0", !selected && "invisible")} aria-hidden />
    </CommandPrimitive.Item>
  );
}

/**
 * The search box and model list. Typing searches every provider the picker offers; with an
 * empty search the list shows the selected tab. Arrow keys and Enter come from the command
 * list; Left on an empty search moves to the rail, Right at the end moves to the effort column.
 */
export function ModelList({
  inputRef,
  query,
  onQueryChange,
  rows,
  selectedKey,
  highlight,
  onHighlight,
  notice,
  empty,
  isFavorite,
  onPick,
  onToggleFavorite,
  onFocusRail,
  onFocusEffort,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (q: string) => void;
  rows: ModelRow[];
  selectedKey: string | null;
  highlight: string;
  onHighlight: (key: string) => void;
  /** Shown above the rows, e.g. setup steps for a provider that isn't ready. */
  notice?: ReactNode;
  /** Shown when the tab has no rows and nothing is searched. */
  empty?: string;
  isFavorite?: (row: ModelRow) => boolean;
  onPick: (row: ModelRow) => void;
  /** Shows a star on each row to add or remove it from the favourites. */
  onToggleFavorite?: (row: ModelRow) => void;
  onFocusRail?: () => void;
  onFocusEffort?: () => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
    const input = e.currentTarget;
    if (onFocusRail && e.key === "ArrowLeft" && !e.shiftKey && input.value.length === 0) {
      e.preventDefault();
      onFocusRail();
    } else if (
      onFocusEffort &&
      e.key === "ArrowRight" &&
      !e.shiftKey &&
      input.selectionStart === input.value.length
    ) {
      e.preventDefault();
      onFocusEffort();
    }
  };
  return (
    <CommandPrimitive
      shouldFilter={false}
      loop
      value={highlight}
      onValueChange={onHighlight}
      label="Models"
      className="flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <CommandPrimitive.Input
          ref={inputRef}
          value={query}
          onValueChange={onQueryChange}
          onKeyDown={onKeyDown}
          placeholder="Search models…"
          aria-label="Search models"
          className="h-full w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/70"
        />
      </div>
      <CommandPrimitive.List
        label="Models"
        className="min-h-0 flex-1 overflow-y-auto p-1.5 scroll-thin"
      >
        {notice}
        {rows.length === 0 ? (
          <CommandPrimitive.Empty className="px-3 py-6 text-center text-xs text-muted-foreground">
            {query
              ? `No models match "${query}"`
              : (empty ?? "This provider reports no models yet.")}
          </CommandPrimitive.Empty>
        ) : (
          rows.map((row) => (
            <Row
              key={row.key}
              row={row}
              selected={row.key === selectedKey}
              highlighted={row.key === highlight}
              favorite={isFavorite?.(row) ?? false}
              onPick={onPick}
              onToggleFavorite={onToggleFavorite}
            />
          ))
        )}
      </CommandPrimitive.List>
    </CommandPrimitive>
  );
}
