import type { AutomationGuards, OverlapPolicy } from "@codeden/contracts";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field, Segmented } from "./form-bits";
import { OVERLAP_HELP, OVERLAP_LABEL } from "./meta";

const POLICIES: OverlapPolicy[] = ["skip-if-running", "queue", "run-anyway"];

const positive = (s: string): number | null => {
  const n = Number.parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * Guards (§10, §8.4): overlap policy for the work-key check, concurrency cap, quiet hours,
 * a daily maximum and catching up a missed run after downtime.
 */
export function GuardsEditor({
  guards,
  onChange,
  disabled,
  projectTimezone,
}: {
  guards: AutomationGuards;
  onChange: (g: AutomationGuards) => void;
  disabled?: boolean;
  projectTimezone: string;
}) {
  const id = useId();
  const quiet = guards.quietHours;
  return (
    <div className="space-y-4">
      <Field label="When matching work is still running" help={OVERLAP_HELP[guards.overlapPolicy]}>
        <Segmented
          label="Overlap policy"
          value={guards.overlapPolicy}
          disabled={disabled}
          onChange={(overlapPolicy) => onChange({ ...guards, overlapPolicy })}
          options={POLICIES.map((p) => ({ id: p, label: OVERLAP_LABEL[p] }))}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Concurrent runs"
          htmlFor={`${id}-conc`}
          help="Runs of this automation at once in a project."
        >
          <Input
            id={`${id}-conc`}
            type="number"
            min={1}
            value={guards.maxConcurrent}
            disabled={disabled}
            onChange={(e) => onChange({ ...guards, maxConcurrent: positive(e.target.value) ?? 1 })}
            className="w-28 text-[13px]"
          />
        </Field>
        <Field
          label="Most runs per day"
          htmlFor={`${id}-day`}
          help="Leave empty for no limit. Skipped runs don't count."
        >
          <Input
            id={`${id}-day`}
            type="number"
            min={1}
            value={guards.maxPerDay ?? ""}
            placeholder="No limit"
            disabled={disabled}
            onChange={(e) => onChange({ ...guards, maxPerDay: positive(e.target.value) })}
            className="w-28 text-[13px]"
          />
        </Field>
      </div>
      <Field
        label="Quiet hours"
        help={`No scheduled or event runs inside this window (runs are recorded as skipped). Times in ${quiet?.timezone ?? projectTimezone}.`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <Switch
            checked={quiet !== null}
            disabled={disabled}
            aria-label="Quiet hours"
            onCheckedChange={(on) =>
              onChange({ ...guards, quietHours: on ? { start: "22:00", end: "07:00" } : null })
            }
          />
          {quiet && (
            <>
              <Input
                type="time"
                aria-label="Quiet from"
                value={quiet.start}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...guards, quietHours: { ...quiet, start: e.target.value } })
                }
                className="w-28 text-[13px]"
              />
              <span className="text-2xs text-muted-foreground">to</span>
              <Input
                type="time"
                aria-label="Quiet until"
                value={quiet.end}
                disabled={disabled}
                onChange={(e) =>
                  onChange({ ...guards, quietHours: { ...quiet, end: e.target.value } })
                }
                className="w-28 text-[13px]"
              />
            </>
          )}
        </div>
      </Field>
      <div className="flex items-start gap-2.5 text-xs">
        <Switch
          checked={guards.catchUpMissed}
          aria-label="Catch up a missed run"
          disabled={disabled}
          onCheckedChange={(catchUpMissed) => onChange({ ...guards, catchUpMissed })}
          className="mt-0.5"
        />
        <span>
          Catch up a missed run
          <span className="block text-3xs text-muted-foreground">
            When CodeDen was off or asleep at the scheduled time, run once when it is back.
          </span>
        </span>
      </div>
    </div>
  );
}
