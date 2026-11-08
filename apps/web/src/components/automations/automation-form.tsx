import type { AutonomyLevel } from "@codeden/contracts";
import { ChevronRight, FolderGit2, Globe } from "lucide-react";
import { useId } from "react";
import { supportsReadOnly } from "@/components/thread/autonomy";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ActionKindPicker,
  AgentPicker,
  actionText,
  TriagePolicyFields,
  useSessionProvider,
  withActionText,
} from "./action-editor";
import type { AutomationDraft } from "./draft";
import { EditorSection, Field, Segmented } from "./form-bits";
import { GuardsEditor } from "./guards-editor";
import { PermissionsField } from "./permissions-field";
import { PromptField } from "./prompt-field";
import { TriggerEditor } from "./trigger-editor";

type SessionAction = Extract<AutomationDraft["action"], { type: "start_session" }>;

/** Agent and permissions of a session action. */
function AgentSection({
  action,
  onChange,
  disabled,
  defaultAutonomy,
}: {
  action: SessionAction;
  onChange: (a: SessionAction) => void;
  disabled?: boolean;
  defaultAutonomy: AutonomyLevel;
}) {
  const { provider } = useSessionProvider(action);
  return (
    <>
      <EditorSection
        title="Agent"
        description="The provider, model and reasoning effort it runs on."
      >
        <AgentPicker action={action} onChange={onChange} disabled={disabled} />
      </EditorSection>
      <EditorSection
        title="Permissions"
        description="What the agent may do on its own while nobody is watching."
      >
        <PermissionsField
          value={action.autonomy ?? defaultAutonomy}
          onChange={(autonomy) => onChange({ ...action, autonomy })}
          disabled={disabled}
          readOnlySupported={supportsReadOnly(provider)}
        />
      </EditorSection>
    </>
  );
}

/**
 * The automation editor (§10), used to create and to edit: name, target, when it runs, what it
 * does (the prompt with placeholders), the agent, its permissions, and advanced options
 * (session title, work key, guards) collapsed by default.
 */
export function AutomationForm({
  draft,
  onChange,
  disabled,
  projectTimezone,
  defaultAutonomy,
  docKey,
  defaultWorkKey,
}: {
  draft: AutomationDraft;
  onChange: (d: AutomationDraft) => void;
  disabled?: boolean;
  projectTimezone: string;
  defaultAutonomy: AutonomyLevel;
  /** Recreates the prompt editor when a different automation is loaded. */
  docKey: string;
  defaultWorkKey: string;
}) {
  const id = useId();
  const set = (patch: Partial<AutomationDraft>) => onChange({ ...draft, ...patch });
  const action = draft.action;
  return (
    <div className="min-w-0 space-y-5" data-testid="automation-editor">
      <EditorSection title="Basics">
        <Field label="Name" htmlFor={`${id}-name`}>
          <Input
            id={`${id}-name`}
            value={draft.name}
            disabled={disabled}
            placeholder="Weekly dependency check"
            onChange={(e) => set({ name: e.target.value })}
            className="text-[13px]"
          />
        </Field>
        <Field label="Description" htmlFor={`${id}-desc`}>
          <Textarea
            id={`${id}-desc`}
            value={draft.description ?? ""}
            disabled={disabled}
            rows={2}
            placeholder="One line for the list (optional)"
            onChange={(e) => set({ description: e.target.value || null })}
            className="min-h-0 text-[13px]"
          />
        </Field>
        <Field label="Runs in">
          <Segmented
            label="Runs in"
            value={draft.target}
            disabled={disabled}
            onChange={(target) => set({ target })}
            options={[
              { id: "project", label: "This project", icon: <FolderGit2 /> },
              { id: "all_projects", label: "All projects", icon: <Globe /> },
            ]}
          />
        </Field>
      </EditorSection>

      <EditorSection title="When it runs">
        <TriggerEditor
          trigger={draft.trigger}
          onChange={(trigger) => set({ trigger })}
          disabled={disabled}
          projectTimezone={projectTimezone}
          allowCron={action.type !== "triage"}
        />
      </EditorSection>

      <EditorSection title="What it does">
        <ActionKindPicker
          action={action}
          onChange={(a) => set({ action: a })}
          disabled={disabled}
        />
        {action.type === "triage" && (
          <TriagePolicyFields
            policy={action.policy}
            disabled={disabled}
            onChange={(policy) =>
              set({ action: { ...action, policy: policy as typeof action.policy } })
            }
          />
        )}
        <PromptField
          label={
            action.type === "start_session"
              ? "Prompt for the agent"
              : action.type === "message_pm"
                ? "Message to the PM"
                : "Extra guidance for the PM (optional)"
          }
          value={actionText(action)}
          onChange={(text) => set({ action: withActionText(action, text) })}
          trigger={draft.trigger}
          disabled={disabled}
          docKey={`${docKey}:${action.type}`}
          placeholder={
            action.type === "start_session"
              ? "What should the agent do? Say what done looks like, and what to do when there is nothing to do."
              : "Markdown"
          }
        />
      </EditorSection>

      {action.type === "start_session" && (
        <AgentSection
          action={action}
          onChange={(a) => set({ action: a })}
          disabled={disabled}
          defaultAutonomy={defaultAutonomy}
        />
      )}

      <details className="group rounded-xl border border-border bg-card" data-testid="advanced">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-[13px] font-medium [&::-webkit-details-marker]:hidden">
          <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
          Advanced options
          <span className="text-3xs font-normal text-muted-foreground">
            Session title, work key, overlap, limits, quiet hours, missed runs
          </span>
        </summary>
        <div className="space-y-4 border-t border-border p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {action.type === "start_session" && (
              <Field label="Session title" htmlFor={`${id}-title`}>
                <Input
                  id={`${id}-title`}
                  value={action.title ?? ""}
                  placeholder="Defaults to the automation name"
                  disabled={disabled}
                  onChange={(e) =>
                    set({ action: { ...action, title: e.target.value || undefined } })
                  }
                  className="text-[13px]"
                />
              </Field>
            )}
            <Field
              label="Work key"
              htmlFor={`${id}-key`}
              help="Runs with the same key count as the same work, so they never overlap."
            >
              <Input
                id={`${id}-key`}
                value={draft.workKey ?? ""}
                placeholder={defaultWorkKey}
                disabled={disabled}
                onChange={(e) => set({ workKey: e.target.value.trim() || undefined })}
                className="font-mono text-[13px]"
              />
            </Field>
          </div>
          <GuardsEditor
            guards={draft.guards}
            onChange={(guards) => set({ guards })}
            disabled={disabled}
            projectTimezone={projectTimezone}
          />
        </div>
      </details>
    </div>
  );
}
