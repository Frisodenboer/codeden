import type { AutomationAction, TriagePolicy } from "@codeden/contracts";
import { Bot, Filter, MessageSquare } from "lucide-react";
import { useId } from "react";
import { ModelPicker } from "@/components/composer/model-picker/model-picker";
import { AutonomyPicker } from "@/components/composer/pickers";
import { CodeEditor } from "@/components/editor/code-editor";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSnapshotData } from "@/lib/queries";
import { Field, Segmented } from "./form-bits";

type SessionAction = Extract<AutomationAction, { type: "start_session" }>;

const PLACEHOLDERS =
  "{{project.name}} {{date}} {{time}} {{issue.number}} {{issue.title}} {{pr.number}} {{pr.branch}} {{session.summary}}";

/** Provider, model, effort and autonomy of the sessions a run starts. */
function SessionSettings({
  action,
  onChange,
  disabled,
}: {
  action: SessionAction;
  onChange: (a: AutomationAction) => void;
  disabled?: boolean;
}) {
  const providers = useSnapshotData((s) => s.runner.providers, []);
  const fallback = useSnapshotData((s) => s.settings.providers.agent.provider, null);
  const known = (id: string | null | undefined) =>
    id && providers.some((p) => p.id === id) ? id : null;
  const providerId = action.provider ?? known(fallback) ?? providers[0]?.id ?? null;
  const provider = providers.find((p) => p.id === providerId);
  const custom = Boolean(action.provider || action.model || action.effort);
  return (
    <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-border px-1 py-0.5">
      {provider ? (
        <ModelPicker
          providers={providers}
          value={{
            provider: provider.id,
            model: action.model ?? null,
            effort: action.effort ?? null,
          }}
          disabled={disabled}
          onChange={(next) =>
            onChange({
              ...action,
              provider: next.provider,
              model: next.model ?? undefined,
              effort: next.effort ?? undefined,
            })
          }
        />
      ) : (
        <span className="px-2 text-xs text-muted-foreground">
          {action.provider ?? "Default provider"} (not connected)
        </span>
      )}
      <AutonomyPicker
        value={action.autonomy ?? "auto"}
        onChange={(autonomy) => onChange({ ...action, autonomy })}
      />
      {custom && !disabled && (
        <button
          type="button"
          className="ml-auto px-2 text-3xs text-muted-foreground hover:text-foreground"
          onClick={() =>
            onChange({ ...action, provider: undefined, model: undefined, effort: undefined })
          }
        >
          Use project default
        </button>
      )}
    </div>
  );
}

function TriagePolicyFields({
  policy,
  onChange,
  disabled,
}: {
  policy: Partial<TriagePolicy> | undefined;
  onChange: (p: Partial<TriagePolicy>) => void;
  disabled?: boolean;
}) {
  const rows: { key: "comment" | "closeRejected" | "autoStart"; label: string; on: boolean }[] = [
    {
      key: "comment",
      label: "Comment on the issue with the decision",
      on: policy?.comment ?? true,
    },
    {
      key: "closeRejected",
      label: "Close duplicates and out-of-scope issues",
      on: policy?.closeRejected ?? false,
    },
    {
      key: "autoStart",
      label: "Start a session for ready issues without asking",
      on: policy?.autoStart ?? false,
    },
  ];
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2.5 text-xs">
          <Switch
            size="sm"
            checked={r.on}
            disabled={disabled}
            aria-label={r.label}
            onCheckedChange={(v) => onChange({ ...policy, [r.key]: v })}
          />
          {r.label}
        </div>
      ))}
      <p className="text-3xs text-muted-foreground">
        Without auto-start (and always in manual projects) ready issues become a "Should I take this
        on?" decision in your inbox.
      </p>
    </div>
  );
}

/**
 * Action editor (§10): start a session (provider, model, effort, autonomy and a Markdown prompt
 * template), message the PM, or triage the issue.
 */
export function ActionEditor({
  action,
  onChange,
  disabled,
  docKey,
}: {
  action: AutomationAction;
  onChange: (a: AutomationAction) => void;
  disabled?: boolean;
  /** Recreates the prompt editor when the automation changes. */
  docKey: string;
}) {
  const id = useId();
  const switchTo = (type: AutomationAction["type"]) => {
    if (type === action.type) return;
    const text =
      action.type === "start_session"
        ? action.prompt
        : action.type === "message_pm"
          ? action.message
          : (action.instructions ?? "");
    if (type === "start_session") onChange({ type, prompt: text || "Describe the task…" });
    else if (type === "message_pm") onChange({ type, message: text || "Check in on…" });
    else onChange({ type, instructions: text || undefined });
  };
  const text =
    action.type === "start_session"
      ? action.prompt
      : action.type === "message_pm"
        ? action.message
        : (action.instructions ?? "");
  const setText = (value: string) => {
    if (action.type === "start_session") onChange({ ...action, prompt: value });
    else if (action.type === "message_pm") onChange({ ...action, message: value });
    else onChange({ ...action, instructions: value || undefined });
  };
  return (
    <div className="space-y-4">
      <Segmented
        label="Action"
        value={action.type}
        disabled={disabled}
        onChange={switchTo}
        options={[
          { id: "start_session", label: "Start a session", icon: <Bot /> },
          { id: "message_pm", label: "Message the PM", icon: <MessageSquare /> },
          { id: "triage", label: "Triage", icon: <Filter /> },
        ]}
      />
      {action.type === "start_session" && (
        <>
          <Field label="Session title" htmlFor={`${id}-title`}>
            <Input
              id={`${id}-title`}
              value={action.title ?? ""}
              placeholder="Defaults to the automation name"
              disabled={disabled}
              onChange={(e) => onChange({ ...action, title: e.target.value || undefined })}
              className="text-[13px]"
            />
          </Field>
          <Field label="Provider, model and autonomy">
            <SessionSettings action={action} onChange={onChange} disabled={disabled} />
          </Field>
        </>
      )}
      {action.type === "triage" && (
        <TriagePolicyFields
          policy={action.policy}
          disabled={disabled}
          onChange={(policy) => onChange({ ...action, policy: policy as TriagePolicy })}
        />
      )}
      <Field
        label={
          action.type === "start_session"
            ? "Prompt template"
            : action.type === "message_pm"
              ? "Message to the PM"
              : "Extra guidance for the PM"
        }
        help={<span className="font-mono">{PLACEHOLDERS}</span>}
      >
        <div
          className="h-80 overflow-hidden rounded-lg border border-border bg-surface"
          data-testid="prompt-editor"
        >
          {disabled ? (
            <pre className="h-full overflow-auto p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap text-muted-foreground scroll-thin">
              {text}
            </pre>
          ) : (
            <CodeEditor
              value={text}
              onChange={setText}
              path="prompt.md"
              docKey={`${docKey}:${action.type}`}
              placeholder="Markdown; {{placeholders}} are filled from the trigger."
            />
          )}
        </div>
      </Field>
    </div>
  );
}
