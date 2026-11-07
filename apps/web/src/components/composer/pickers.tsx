import type { AutonomyLevel, ProviderInfo, ReasoningEffort } from "@codeden/contracts";
import { Check, ChevronDown } from "lucide-react";
import { ProviderMark } from "@/components/common/bits";
import { AUTONOMY } from "@/components/thread/autonomy";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const trigger = "h-7 gap-1.5 px-2 text-xs font-normal text-muted-foreground hover:text-foreground";

/** Provider + model picker, grouped by provider. */
export function ModelPicker({
  providers,
  provider,
  model,
  onChange,
  disabled,
}: {
  providers: ProviderInfo[];
  provider: string;
  model: string | null;
  onChange: (provider: string, model: string) => void;
  disabled?: boolean;
}) {
  const current = providers.find((p) => p.id === provider);
  const modelInfo =
    current?.models.find((m) => m.id === model) ?? current?.models.find((m) => m.isDefault);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Button variant="ghost" size="sm" className={trigger} aria-label="Provider and model">
          <ProviderMark provider={provider} className="size-3.5 text-[8px]" />
          <span className="text-foreground/85">
            {modelInfo?.label ?? current?.displayName ?? provider}
          </span>
          <ChevronDown className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        {providers.map((p, i) => (
          <div key={p.id}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="flex items-center gap-2 text-2xs">
              <ProviderMark provider={p.id} /> {p.displayName}
            </DropdownMenuLabel>
            {p.models.map((m) => (
              <DropdownMenuItem
                key={m.id}
                onSelect={() => onChange(p.id, m.id)}
                className="items-start py-1.5"
              >
                <span className="flex size-4 items-center justify-center">
                  {p.id === provider && m.id === modelInfo?.id && <Check className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px]">{m.label}</span>
                  {m.description && (
                    <span className="block text-2xs text-muted-foreground">{m.description}</span>
                  )}
                </span>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const effortOrder: ReasoningEffort[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
const effortName: Record<ReasoningEffort, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

/** Rising bars: how hard the model thinks. */
export function EffortGlyph({ level, of }: { level: number; of: number }) {
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden>
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

/** Reasoning effort picker; hidden when the model has no effort levels. */
export function EffortPicker({
  efforts,
  value,
  onChange,
}: {
  efforts: ReasoningEffort[];
  value: ReasoningEffort | null;
  onChange: (e: ReasoningEffort) => void;
}) {
  if (efforts.length === 0) return null;
  const sorted = effortOrder.filter((e) => efforts.includes(e));
  const current =
    value && sorted.includes(value) ? value : (sorted[Math.floor(sorted.length / 2)] ?? sorted[0]);
  const level = current ? sorted.indexOf(current) + 1 : 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={trigger} aria-label="Reasoning effort">
          <EffortGlyph level={level} of={sorted.length} />
          {current ? effortName[current] : "Effort"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-44">
        <DropdownMenuLabel className="text-2xs">Reasoning effort</DropdownMenuLabel>
        {sorted.map((e, i) => (
          <DropdownMenuItem key={e} onSelect={() => onChange(e)}>
            <EffortGlyph level={i + 1} of={sorted.length} />
            <span className="flex-1">{effortName[e]}</span>
            {e === current && <Check className="size-3.5" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Autonomy level picker (§11.2). */
export function AutonomyPicker({
  value,
  onChange,
}: {
  value: AutonomyLevel;
  onChange: (v: AutonomyLevel) => void;
}) {
  const a = AUTONOMY[value];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={trigger} aria-label="Autonomy level">
          <a.icon className={cn("size-3.5", a.tone)} />
          {a.short}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-2xs">Autonomy for this session</DropdownMenuLabel>
        {(Object.keys(AUTONOMY) as AutonomyLevel[]).map((level) => {
          const o = AUTONOMY[level];
          return (
            <DropdownMenuItem
              key={level}
              onSelect={() => onChange(level)}
              className="items-start py-1.5"
            >
              <o.icon className={cn("mt-0.5 size-4", o.tone)} />
              <span className="min-w-0 flex-1">
                <span className="block text-[13px]">{o.label}</span>
                <span className="block text-2xs text-muted-foreground">{o.description}</span>
              </span>
              {level === value && <Check className="mt-0.5 size-3.5" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
