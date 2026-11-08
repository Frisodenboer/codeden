import type { ProviderInfo, ReasoningEffort } from "@codeden/contracts";
import { ChevronDown, Sparkles } from "lucide-react";
import type { ComponentProps } from "react";
import { ProviderMark } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EffortGlyph } from "./effort-glyph";
import { DEFAULT_MODEL_ID, EFFORT_NAME, modelName, type ResolvedModel, triggerText } from "./logic";

export const TRIGGER_CLASS =
  "h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground";

/** The picker's button: provider mark, model, and the effort as bars plus its name. */
export function PickerTrigger({
  providerId,
  provider,
  resolved,
  modelId,
  effort,
  levels,
  placeholder,
  ready,
  className,
  ...props
}: ComponentProps<"button"> & {
  providerId: string | null;
  provider: ProviderInfo | undefined;
  resolved: ResolvedModel;
  /** Shown when the provider (and so the model) isn't known to the runner. */
  modelId: string | null;
  effort: ReasoningEffort | null;
  levels: ReasoningEffort[];
  placeholder: string;
  ready: boolean;
}) {
  // Without the provider's list (runner offline) the stored id is all there is to show.
  const unlisted =
    modelId === null || modelId === DEFAULT_MODEL_ID ? `${providerId} · Default` : modelId;
  const text = providerId ? (provider ? triggerText(provider, resolved) : unlisted) : placeholder;
  const name = providerId
    ? provider
      ? [provider.displayName, modelName(resolved)].filter(Boolean).join(" ")
      : unlisted
    : placeholder;
  const label = [
    `Provider and model: ${name}`,
    effort ? `${EFFORT_NAME[effort]} effort` : null,
    ready ? null : "provider not ready",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={label}
      title={label.replace("Provider and model: ", "")}
      className={cn(TRIGGER_CLASS, "min-w-0", className)}
      {...props}
    >
      {providerId ? (
        <span className="relative flex">
          <ProviderMark provider={providerId} className="size-3.5 text-[8px]" />
          {!ready && (
            <span
              aria-hidden
              className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-status-waiting ring-1 ring-background"
            />
          )}
        </span>
      ) : (
        <Sparkles className="size-3.5" aria-hidden />
      )}
      <span className="max-w-44 truncate text-foreground/85">{text}</span>
      {effort && (
        <span className="flex items-center gap-1.5 pl-0.5">
          <EffortGlyph level={levels.indexOf(effort) + 1} of={levels.length} />
          {EFFORT_NAME[effort]}
        </span>
      )}
      <ChevronDown className="size-3 opacity-50" aria-hidden />
    </Button>
  );
}
