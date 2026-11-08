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
import { cn } from "@/lib/utils";
import { Field } from "./form-bits";
import { EVENT_LABEL } from "./meta";
import { SchedulePicker } from "./schedule-picker";

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
          <SelectTrigger className="w-80" aria-label="Event">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(EVENT_LABEL) as AutomationEventName[]).map((e) => (
              <SelectItem key={e} value={e}>
                When {EVENT_LABEL[e].charAt(0).toLowerCase()}
                {EVENT_LABEL[e].slice(1)}
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

const KINDS: {
  id: AutomationTrigger["type"];
  label: string;
  help: string;
  icon: typeof CalendarClock;
}[] = [
  {
    id: "cron",
    label: "On a schedule",
    help: "Every few minutes, daily, weekly…",
    icon: CalendarClock,
  },
  { id: "event", label: "When something happens", help: "A PR, an issue or a session", icon: Zap },
  { id: "manual", label: "Only when I run it", help: "Run now, or the PM runs it", icon: Hand },
];

/**
 * When an automation runs (§10): on a schedule (human choices, a plain-English summary and the
 * next runs), when something happens (an event, in plain words), or only when run by hand.
 */
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
  const switchTo = (type: AutomationTrigger["type"]) => {
    if (type === trigger.type) return;
    if (type === "cron") onChange({ type: "cron", expression: "0 9 * * 1-5" });
    else if (type === "event") onChange({ type: "event", event: "pr.checks_failed" });
    else onChange({ type: "manual" });
  };
  return (
    <div className="space-y-4">
      <fieldset className="grid gap-2 sm:grid-cols-3" aria-label="When it runs">
        {KINDS.filter((k) => allowCron || k.id !== "cron").map((k) => (
          <button
            key={k.id}
            type="button"
            aria-pressed={trigger.type === k.id}
            disabled={disabled}
            onClick={() => switchTo(k.id)}
            className={cn(
              "flex items-start gap-2.5 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-primary/40 disabled:pointer-events-none disabled:opacity-60",
              trigger.type === k.id && "border-primary/60 bg-primary/[0.06] ring-1 ring-primary/30",
            )}
          >
            <k.icon
              className={cn(
                "mt-0.5 size-4 shrink-0 text-muted-foreground",
                trigger.type === k.id && "text-primary",
              )}
            />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{k.label}</span>
              <span className="block text-3xs text-muted-foreground">{k.help}</span>
            </span>
          </button>
        ))}
      </fieldset>
      {trigger.type === "cron" && (
        <SchedulePicker
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
          Runs only when you press Run now, or when the PM runs it.
        </p>
      )}
    </div>
  );
}
