import type { AutomationTrigger } from "@codeden/contracts";
import { CalendarClock } from "lucide-react";
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatAt, timezones } from "@/lib/cron";
import {
  DAY_NAMES,
  fromCron,
  HOUR_STEPS,
  MINUTE_STEPS,
  SCHEDULE_KINDS,
  type ScheduleChoice,
  type ScheduleKind,
  schedulePreview,
  switchKind,
  toCron,
} from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { Field } from "./form-bits";

type CronTrigger = Extract<AutomationTrigger, { type: "cron" }>;

/** A small labelled select of numbers or names. */
function Pick<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={String(value)}
      disabled={disabled}
      onValueChange={(v) => {
        const found = options.find((o) => String(o.value) === v);
        if (found) onChange(found.value);
      }}
    >
      <SelectTrigger
        className={cn("h-8 w-auto min-w-24 text-[13px]", className)}
        aria-label={label}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={String(o.value)} value={String(o.value)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function TimeInput({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Input
      type="time"
      aria-label="Time"
      value={value}
      disabled={disabled}
      onChange={(e) => e.target.value && onChange(e.target.value)}
      className="h-8 w-28 text-[13px]"
    />
  );
}

const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** The fields of one schedule choice, in a sentence: "every [15] minutes", "on [Monday] at [09:00]". */
function ChoiceFields({
  choice,
  onChange,
  disabled,
}: {
  choice: ScheduleChoice;
  onChange: (c: ScheduleChoice) => void;
  disabled?: boolean;
}) {
  const text = "text-xs text-muted-foreground";
  switch (choice.kind) {
    case "minutes":
      return (
        <>
          <span className={text}>every</span>
          <Pick
            label="Minutes"
            value={choice.every}
            disabled={disabled}
            options={MINUTE_STEPS.map((n) => ({ value: n, label: `${n} minutes` }))}
            onChange={(every) => onChange({ ...choice, every })}
          />
        </>
      );
    case "hours":
      return (
        <>
          <span className={text}>every</span>
          <Pick
            label="Hours"
            value={choice.every}
            disabled={disabled}
            options={HOUR_STEPS.map((n) => ({ value: n, label: n === 1 ? "hour" : `${n} hours` }))}
            onChange={(every) => onChange({ ...choice, every })}
          />
          <span className={text}>at minute</span>
          <Pick
            label="Minute past the hour"
            value={choice.minute}
            disabled={disabled}
            options={[0, 5, 10, 15, 20, 30, 45].map((n) => ({
              value: n,
              label: `:${String(n).padStart(2, "0")}`,
            }))}
            onChange={(minute) => onChange({ ...choice, minute })}
          />
        </>
      );
    case "daily":
    case "weekdays":
      return (
        <>
          <span className={text}>at</span>
          <TimeInput
            value={choice.time}
            disabled={disabled}
            onChange={(time) => onChange({ ...choice, time })}
          />
        </>
      );
    case "weekly":
      return (
        <>
          <span className={text}>on</span>
          <Pick
            label="Day of the week"
            value={choice.day}
            disabled={disabled}
            options={[1, 2, 3, 4, 5, 6, 0].map((d) => ({ value: d, label: DAY_NAMES[d] ?? "" }))}
            onChange={(day) => onChange({ ...choice, day })}
          />
          <span className={text}>at</span>
          <TimeInput
            value={choice.time}
            disabled={disabled}
            onChange={(time) => onChange({ ...choice, time })}
          />
        </>
      );
    case "monthly":
      return (
        <>
          <span className={text}>on the</span>
          <Pick
            label="Day of the month"
            value={choice.day}
            disabled={disabled}
            options={Array.from({ length: 28 }, (_, i) => ({
              value: i + 1,
              label: ordinal(i + 1),
            }))}
            onChange={(day) => onChange({ ...choice, day })}
          />
          <span className={text}>at</span>
          <TimeInput
            value={choice.time}
            disabled={disabled}
            onChange={(time) => onChange({ ...choice, time })}
          />
        </>
      );
    case "custom":
      return (
        <Input
          aria-label="Cron expression"
          value={choice.expression}
          disabled={disabled}
          spellCheck={false}
          placeholder="0 9 * * 1-5"
          onChange={(e) => onChange({ kind: "custom", expression: e.target.value })}
          className="h-8 w-56 font-mono text-[13px]"
        />
      );
  }
}

/**
 * The schedule of a cron trigger as human choices (every N minutes or hours, daily, weekdays,
 * weekly, monthly) with "Custom (cron)" last, a timezone, a plain-English summary and the next
 * three runs in that timezone. Stores the cron expression.
 */
export function SchedulePicker({
  trigger,
  onChange,
  disabled,
  projectTimezone,
}: {
  trigger: CronTrigger;
  onChange: (t: CronTrigger) => void;
  disabled?: boolean;
  projectTimezone: string;
}) {
  const id = useId();
  // Custom stays custom while editing, even when the cron happens to match a human choice.
  const [custom, setCustom] = useState(() => fromCron(trigger.expression).kind === "custom");
  const choice: ScheduleChoice = custom
    ? { kind: "custom", expression: trigger.expression }
    : fromCron(trigger.expression);
  const set = (next: ScheduleChoice) => {
    setCustom(next.kind === "custom");
    onChange({ ...trigger, expression: next.kind === "custom" ? next.expression : toCron(next) });
  };
  const tz = trigger.timezone || projectTimezone;
  const preview = schedulePreview(trigger.expression, tz);
  return (
    <div className="space-y-3" data-testid="schedule-picker">
      <div className="flex flex-wrap items-center gap-2">
        <Pick<ScheduleKind>
          label="How often"
          value={choice.kind}
          disabled={disabled}
          className="min-w-40"
          options={SCHEDULE_KINDS.map((k) => ({ value: k.id, label: k.label }))}
          onChange={(kind) => kind !== choice.kind && set(switchKind(kind, choice))}
        />
        <ChoiceFields choice={choice} onChange={set} disabled={disabled} />
      </div>
      <Field
        label="Timezone"
        htmlFor={`${id}-tz`}
        help={`Empty: the project's timezone (${projectTimezone}).`}
        className="max-w-xs"
      >
        <Input
          id={`${id}-tz`}
          list={`${id}-tzs`}
          value={trigger.timezone ?? ""}
          placeholder={projectTimezone}
          disabled={disabled}
          onChange={(e) => onChange({ ...trigger, timezone: e.target.value.trim() || undefined })}
          className="h-8 text-[13px]"
        />
        <datalist id={`${id}-tzs`}>
          {timezones().map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>
      </Field>
      <div
        className={cn(
          "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-2xs",
          preview.error ? "border-status-failed/30 bg-status-failed/5" : "border-border bg-surface",
        )}
        data-testid="cron-preview"
      >
        <CalendarClock
          className={cn(
            "mt-px size-3.5 shrink-0",
            preview.error ? "text-status-failed" : "text-primary",
          )}
        />
        {preview.error ? (
          <span className="text-status-failed">{preview.error}</span>
        ) : (
          <span className="min-w-0">
            <span className="font-medium text-foreground" data-testid="schedule-summary">
              {preview.summary}
            </span>
            <span className="text-muted-foreground"> · {tz}</span>
            {choice.kind === "custom" && (
              <code className="ml-1.5 font-mono text-muted-foreground">{trigger.expression}</code>
            )}
            <span className="mt-1 block text-muted-foreground">
              Next: {preview.next.map((d) => formatAt(d, tz)).join("  ·  ")}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
