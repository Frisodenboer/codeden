import { CalendarDays } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { localToday, shiftDay, shortDay } from "./format";

export type RangePreset = "today" | "7d" | "30d" | "90d" | "custom";

export interface UsageRange {
  preset: RangePreset;
  from: string;
  to: string;
}

const PRESETS: { id: Exclude<RangePreset, "custom">; label: string; days: number }[] = [
  { id: "today", label: "Today", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
];

/** The days a preset covers, ending today. */
export function presetRange(
  preset: Exclude<RangePreset, "custom">,
  today = localToday(),
): UsageRange {
  const days = PRESETS.find((p) => p.id === preset)?.days ?? 30;
  return { preset, from: shiftDay(today, -(days - 1)), to: today };
}

/** Segmented range control: today, 7, 30 or 90 days, or a custom pair of dates. */
export function RangePicker({
  value,
  onChange,
}: {
  value: UsageRange;
  onChange: (range: UsageRange) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const valid = Boolean(from && to && from <= to);

  return (
    <div className="flex items-center gap-1.5">
      <fieldset
        aria-label="Time range"
        className="flex items-center gap-0.5 rounded-lg border border-border bg-card/50 p-0.5 text-xs"
      >
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={value.preset === p.id}
            onClick={() => onChange(presetRange(p.id))}
            className={cn(
              "h-7 rounded-md px-2.5 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              value.preset === p.id && "bg-accent text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </fieldset>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setFrom(value.from);
            setTo(value.to);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-pressed={value.preset === "custom"}
            className={cn("h-8 gap-1.5 text-xs", value.preset === "custom" && "bg-accent")}
          >
            <CalendarDays className="size-3.5" />
            {value.preset === "custom"
              ? `${shortDay(value.from)} – ${shortDay(value.to)}`
              : "Custom"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label htmlFor="usage-from" className="text-2xs">
                From
              </Label>
              <Input
                id="usage-from"
                type="date"
                value={from}
                max={to}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="usage-to" className="text-2xs">
                To
              </Label>
              <Input
                id="usage-to"
                type="date"
                value={to}
                min={from}
                max={localToday()}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
          <Button
            size="sm"
            className="w-full"
            disabled={!valid}
            onClick={() => {
              onChange({ preset: "custom", from, to });
              setOpen(false);
            }}
          >
            Apply range
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
