import type { AutonomyLevel } from "@codeden/contracts";
import { Check } from "lucide-react";
import { AUTONOMY } from "@/components/thread/autonomy";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { TRIGGER_CLASS } from "./model-picker/trigger";

/** Autonomy level picker (§11.2). Provider, model and effort live in `model-picker/`. */
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
        <Button variant="ghost" size="sm" className={TRIGGER_CLASS} aria-label="Autonomy level">
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
