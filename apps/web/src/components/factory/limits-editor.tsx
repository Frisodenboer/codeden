import type { FactoryLimits, FactoryTuning } from "@codeden/contracts";
import { useId } from "react";
import { Field } from "@/components/automations/form-bits";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

/** The tuning knobs the editor exposes (the rest keep their defaults). */
export type TuningDraft = Pick<FactoryTuning, "requireCi" | "maxChangedLines" | "auditCommand">;

const int = (s: string, min = 0): number | undefined => {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n >= min ? n : undefined;
};

/** True when the limits carry the daily budget factory modes require. */
export function hasBudget(limits: FactoryLimits): boolean {
  return Boolean(limits.dailyBudget.usd || limits.dailyBudget.tokens);
}

/**
 * Factory limits (§10.1), enforced by the server rather than left to agents: a daily budget,
 * concurrency, merges per day, the failure streak that pauses the loop, protected paths and
 * deploys. Optionally the main tuning knobs.
 */
export function LimitsEditor({
  limits,
  onChange,
  tuning,
  onTuningChange,
}: {
  limits: FactoryLimits;
  onChange: (l: FactoryLimits) => void;
  tuning?: TuningDraft;
  onTuningChange?: (t: TuningDraft) => void;
}) {
  const id = useId();
  const budget = limits.dailyBudget;
  const setBudget = (patch: Partial<FactoryLimits["dailyBudget"]>) => {
    const next = { ...budget, ...patch };
    for (const k of ["usd", "tokens"] as const) if (!next[k]) delete next[k];
    onChange({ ...limits, dailyBudget: next });
  };
  return (
    <div className="space-y-4" data-testid="limits-editor">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field
          label="Daily budget (USD)"
          htmlFor={`${id}-usd`}
          help="The loop pauses until tomorrow when today's spend reaches it."
        >
          <Input
            id={`${id}-usd`}
            type="number"
            min={0}
            step="0.5"
            value={budget.usd ?? ""}
            placeholder="e.g. 10"
            onChange={(e) => {
              const n = Number.parseFloat(e.target.value);
              setBudget({ usd: Number.isFinite(n) && n > 0 ? n : undefined });
            }}
            className="text-[13px]"
          />
        </Field>
        <Field label="Daily budget (tokens)" htmlFor={`${id}-tok`} help="Optional, alongside USD.">
          <Input
            id={`${id}-tok`}
            type="number"
            min={0}
            step={100000}
            value={budget.tokens ?? ""}
            placeholder="e.g. 5000000"
            onChange={(e) => setBudget({ tokens: int(e.target.value, 1) })}
            className="text-[13px]"
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Sessions at once" htmlFor={`${id}-conc`}>
          <Input
            id={`${id}-conc`}
            type="number"
            min={1}
            value={limits.maxConcurrentSessions}
            onChange={(e) =>
              onChange({ ...limits, maxConcurrentSessions: int(e.target.value, 1) ?? 1 })
            }
            className="text-[13px]"
          />
        </Field>
        <Field label="Merges per day" htmlFor={`${id}-merges`}>
          <Input
            id={`${id}-merges`}
            type="number"
            min={0}
            value={limits.maxMergesPerDay}
            onChange={(e) => onChange({ ...limits, maxMergesPerDay: int(e.target.value) ?? 0 })}
            className="text-[13px]"
          />
        </Field>
        <Field label="Pause after failures" htmlFor={`${id}-fails`}>
          <Input
            id={`${id}-fails`}
            type="number"
            min={1}
            value={limits.pauseAfterConsecutiveFailures}
            onChange={(e) =>
              onChange({ ...limits, pauseAfterConsecutiveFailures: int(e.target.value, 1) ?? 1 })
            }
            className="text-[13px]"
          />
        </Field>
      </div>
      <Field
        label="Protected paths"
        htmlFor={`${id}-paths`}
        help="One glob per line, on top of the vision's protected areas. Changes there always go to you."
      >
        <Textarea
          id={`${id}-paths`}
          value={limits.protectedPaths.join("\n")}
          placeholder={"**/auth/**\ninfra/**"}
          onChange={(e) =>
            onChange({
              ...limits,
              protectedPaths: e.target.value
                .split("\n")
                .map((l) => l.trim())
                .filter(Boolean),
            })
          }
          className="min-h-20 font-mono text-[12.5px]"
        />
      </Field>
      <div className="flex items-start gap-2.5 text-xs">
        <Switch
          checked={limits.allowDeploys}
          aria-label="Allow deploys"
          onCheckedChange={(allowDeploys) => onChange({ ...limits, allowDeploys })}
          className="mt-0.5"
        />
        <span>
          Allow deploy and release changes
          <span className="block text-3xs text-muted-foreground">
            Off: workflows, Dockerfiles and hosting configs count as protected.
          </span>
        </span>
      </div>
      {tuning && onTuningChange && (
        <div className="grid gap-3 border-t border-border pt-4 sm:grid-cols-[auto_140px_minmax(0,1fr)]">
          <div className="flex items-center gap-2 text-xs">
            <Switch
              checked={tuning.requireCi}
              aria-label="Require CI"
              onCheckedChange={(requireCi) => onTuningChange({ ...tuning, requireCi })}
            />
            Require CI
          </div>
          <Field label="Largest change (lines)" htmlFor={`${id}-lines`}>
            <Input
              id={`${id}-lines`}
              type="number"
              min={1}
              value={tuning.maxChangedLines}
              onChange={(e) =>
                onTuningChange({ ...tuning, maxChangedLines: int(e.target.value, 1) ?? 1 })
              }
              className="text-[13px]"
            />
          </Field>
          <Field label="Audit command" htmlFor={`${id}-audit`}>
            <Input
              id={`${id}-audit`}
              value={tuning.auditCommand ?? ""}
              placeholder="pnpm audit --prod"
              onChange={(e) =>
                onTuningChange({ ...tuning, auditCommand: e.target.value.trim() || null })
              }
              className="font-mono text-[12.5px]"
            />
          </Field>
        </div>
      )}
    </div>
  );
}
