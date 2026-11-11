import {
  type Automation,
  AutomationAction,
  AutomationGuardsPatch,
  AutomationTrigger,
} from "@codeden/contracts";
import { z } from "zod";
import { defineTool } from "../../define";

const fields = {
  name: z.string().trim().min(1).max(200),
  description: z.string().max(500).nullable(),
  trigger: AutomationTrigger.describe(
    "{type:'cron', expression:'0 9 * * 1-5', timezone?} | {type:'event', event:'pr.checks_failed', filter?} | {type:'manual'}",
  ),
  action: AutomationAction.describe(
    "{type:'start_session', prompt, title?, provider?, model?, effort?, autonomy?: 'read_only'|'supervised'|'auto'|'full'} | {type:'message_pm', message} | {type:'triage', policy?, instructions?}",
  ),
  guards: AutomationGuardsPatch,
  workKey: z.string().min(1).max(200).describe("<kind>:<id>, e.g. automation:release-notes"),
};

const summary = (a: Automation) => ({
  id: a.id,
  name: a.name,
  enabled: a.enabled,
  trigger: a.trigger,
  action: a.action.type,
  workKey: a.workKey ?? null,
});

/** `create_automation` (§10): a new automation for this project, created off. */
export const createAutomation = defineTool({
  name: "create_automation",
  description:
    "Create an automation for this project (or all projects with allProjects: true): a trigger (cron schedule, event or manual), an action (start an agent session with a prompt, message you, or triage), optional guards and work key. Validated like automation files. It is always created OFF: tell the user, who switches it on in Automations. Use permissions (action.autonomy) no higher than the job needs; 'read_only' for audits and reports.",
  roles: ["pm"],
  scope: "project",
  input: z.object({
    ...fields,
    description: fields.description.optional(),
    guards: fields.guards.optional(),
    workKey: fields.workKey.optional(),
    allProjects: z.boolean().optional(),
  }),
  handler: async ({ allProjects, ...input }, { services, projectId }) => {
    const created = services.automations.definitions.create(
      { ...input, projectId: allProjects ? undefined : projectId, enabled: false },
      { createdBy: "pm" },
    );
    services.automations.refresh();
    return { created: summary(created), note: "Created off; the user switches it on." };
  },
});

/** `update_automation` (§10): change an automation created in CodeDen (not a file). */
export const updateAutomation = defineTool({
  name: "update_automation",
  description:
    "Change an automation of this project that lives in CodeBench (not a .md file): any of name, description, trigger, action, guards or work key. Validated like automation files. Does not switch it on or off. File-based automations are edited in their file.",
  roles: ["pm"],
  scope: "project",
  input: z.object({
    automationId: z.string().min(1),
    name: fields.name.optional(),
    description: fields.description.optional(),
    trigger: fields.trigger.optional(),
    action: fields.action.optional(),
    guards: fields.guards.optional(),
    workKey: fields.workKey.optional(),
  }),
  handler: async ({ automationId, ...patch }, { services, projectId }) => {
    const current = services.automations.definitions.get(automationId);
    if (current.target.type === "project" && current.target.projectId !== projectId) {
      throw new Error(`Automation ${automationId} belongs to another project`);
    }
    const updated = services.automations.definitions.update(automationId, patch);
    services.automations.refresh();
    return { updated: summary(updated) };
  },
});
