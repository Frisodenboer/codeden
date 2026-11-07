import type { AutomationEventName, AutomationTrigger } from "@codeden/contracts";
import { CalendarClock, Hand, Zap } from "lucide-react";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CRON_PRESETS, cronError, describeCron, formatAt, nextRuns, timezones } from "@/lib/cron";
import { cn } from "@/lib/utils";
import { Field, Segmented } from "./form-bits";
import { EVENT_LABEL } from "./meta";

type EventTrigger = Extract<AutomationTrigger, { type: "event" }>;
type Filter = NonNullable<EventTrigger["filter"]>;

const list = (v: string[] | undefined) => (v ?? []).join(", ");
const parseList = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

/** Which filters make sense for an event (labels for issues, branches for PRs, ...). */
function filtersFor(event: AutomationEventName): (keyof Filter)[] {
  if (event.startsWith("issue.")) return ["labels", "authors"];
  if (event.startsWith("pr.")) return ["branches", "authors", "labels"];
  return [];
}

const FILTER_HELP: Record<keyof Filter, string> = {
  labels: "Only when the issue or PR has one of these labels.",
  branches: "Only for PRs into or from these branches.",
  authors: "Only for these GitHub users.",
};

function CronFields({
  trigger,
  onChange,
  disabled,
  projectTimezone,
}: {
  trigger: Extract<AutomationTrigger, { type: "cron" }>;
  onChange: (t: AutomationTrigger) => void;
  disabled?: boolean;
  projectTimezone: string;
}) {
  const id = useId();
  const tz = trigger.timezone || projectTimezone;
  const error = cronError(trigger.expression, tz);
  const upcoming = error ? [] : nextRuns(trigger.expression, tz, 3);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {CRON_PRESETS.map((p) => (
          <button
            key={p.expression}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...trigger, expression: p.expression })}
            className={cn(
              "rounded-full border border-border px-2 py-0.5 text-3xs text-muted-foreground hover:border-primary/40 hover:text-foreground",
              trigger.expression === p.expression && "border-primary/50 bg-primary/8 text-primary",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
        <Field label="Cron expression" htmlFor={`${id}-cron`}>
          <Input
            id={`${id}-cron`}
            value={trigger.expression}
            disabled={disabled}
            onChange={(e) => onChange({ ...trigger, expression: e.target.value })}
            className="font-mono text-[13px]"
            aria-invalid={Boolean(error)}
            spellCheck={false}
          />
        </Field>
        <Field label="Timezone" htmlFor={`${id}-tz`}>
          <Input
            id={`${id}-tz`}
            list={`${id}-tzs`}
            value={trigger.timezone ?? ""}
            placeholder={`${projectTimezone} (project)`}
            disabled={disabled}
            onChange={(e) => onChange({ ...trigger, timezone: e.target.value.trim() || undefined })}
            className="text-[13px]"
          />
          <datalist id={`${id}-tzs`}>
            {timezones().map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </Field>
      </div>
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-2xs",
          error ? "border-status-failed/30 bg-status-failed/5" : "border-border bg-surface",
        )}
        data-testid="cron-preview"
      >
        {error ? (
          <span className="text-status-failed">{error}</span>
        ) : (
          <>
            <span className="font-medium text-foreground">{describeCron(trigger.expression)}</span>
            <span className="text-muted-foreground"> · {tz}</span>
            <span className="mt-1 block text-muted-foreground">
              Next: {upcoming.map((d) => formatAt(d, tz)).join("  ·  ")}
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function EventFields({
  trigger,
  onChange,
  disabled,
}: {
  trigger: EventTrigger;
  onChange: (t: AutomationTrigger) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const setFilter = (key: keyof Filter, value: string) => {
    const next: Filter = { ...trigger.filter, [key]: parseList(value) };
    if (next[key]?.length === 0) delete next[key];
    onChange({ ...trigger, filter: Object.keys(next).length ? next : undefined });
  };
  return (
    <div className="space-y-3">
      <Field label="When">
        <Select
          value={trigger.event}
          disabled={disabled}
          onValueChange={(event) =>
            onChange({ type: "event", event: event as AutomationEventName, filter: trigger.filter })
          }
        >
          <SelectTrigger className="w-72" aria-label="Event">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(EVENT_LABEL) as AutomationEventName[]).map((e) => (
              <SelectItem key={e} value={e}>
                {EVENT_LABEL[e]} <span className="font-mono text-3xs opacity-60">{e}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {filtersFor(trigger.event).map((key) => (
        <Field key={key} label={`Filter: ${key}`} htmlFor={`${id}-${key}`} help={FILTER_HELP[key]}>
          <Input
            id={`${id}-${key}`}
            defaultValue={list(trigger.filter?.[key])}
            disabled={disabled}
            placeholder="Any (comma-separated)"
            onBlur={(e) => setFilter(key, e.target.value)}
            className="text-[13px]"
          />
        </Field>
      ))}
    </div>
  );
}

/** Trigger editor (§10): a cron schedule with a plain-English preview, an event, or manual. */
export function TriggerEditor({
  trigger,
  onChange,
  disabled,
  projectTimezone,
  allowCron = true,
}: {
  trigger: AutomationTrigger;
  onChange: (t: AutomationTrigger) => void;
  disabled?: boolean;
  projectTimezone: string;
  /** Triage runs on issue events only. */
  allowCron?: boolean;
}) {
  const kinds = [
    ...(allowCron ? [{ id: "cron" as const, label: "Schedule", icon: <CalendarClock /> }] : []),
    { id: "event" as const, label: "Event", icon: <Zap /> },
    { id: "manual" as const, label: "Manual", icon: <Hand /> },
  ];
  const switchTo = (type: AutomationTrigger["type"]) => {
    if (type === trigger.type) return;
    if (type === "cron") onChange({ type: "cron", expression: "0 3 * * 1" });
    else if (type === "event") onChange({ type: "event", event: "issue.opened" });
    else onChange({ type: "manual" });
  };
  return (
    <div className="space-y-4">
      <Segmented
        label="Trigger type"
        value={trigger.type}
        options={kinds}
        onChange={switchTo}
        disabled={disabled}
      />
      {trigger.type === "cron" && (
        <CronFields
          trigger={trigger}
          onChange={onChange}
          disabled={disabled}
          projectTimezone={projectTimezone}
        />
      )}
      {trigger.type === "event" && (
        <EventFields trigger={trigger} onChange={onChange} disabled={disabled} />
      )}
      {trigger.type === "manual" && (
        <p className="text-2xs text-muted-foreground">
          Runs only when you press Run now or the PM calls run_automation.
        </p>
      )}
    </div>
  );
}
