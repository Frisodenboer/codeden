import { ConflictDecision, TriageReport } from "@codeden/contracts";
import { z } from "zod";
import { defineTool } from "../../define";
import { inGithubProject } from "../github/available";
import { githubProject } from "../shared/helpers";

/** `list_automations` (§8.3): this project's automations with their state. */
export const listAutomations = defineTool({
  name: "list_automations",
  description:
    "This project's automations (security audit, dependency updates, triage, ...): trigger, action, guards, whether each is enabled or paused here, its next scheduled run and its latest run.",
  roles: ["pm"],
  scope: "project",
  input: z.object({}),
  handler: async (_input, { services, projectId }) => {
    const { automations } = services.automations.list(projectId);
    return {
      count: automations.length,
      automations: automations.map((item) => ({
        id: item.automation.id,
        name: item.automation.name,
        trigger: item.automation.trigger,
        action: item.automation.action.type,
        workKey: item.automation.workKey ?? null,
        overlapPolicy: item.automation.guards.overlapPolicy,
        state: item.states.find((st) => st.projectId === projectId) ?? null,
        lastRun: item.lastRun
          ? {
              id: item.lastRun.id,
              status: item.lastRun.status,
              skipReason: item.lastRun.skipReason,
              sessionId: item.lastRun.sessionId,
              startedAt: item.lastRun.startedAt,
            }
          : null,
      })),
    };
  },
});

/** `run_automation` (§8.3, §8.4): run now, with the conflict check. */
export const runAutomation = defineTool({
  name: "run_automation",
  description:
    "Run one of this project's automations now (even if it is disabled or paused). If matching work is already running or queued, nothing starts and the result is 'conflict' with the existing work: call again with conflict = {resolution: 'wait'}, {resolution: 'skip'}, {resolution: 'join', sessionId} or {resolution: 'force', reason}.",
  roles: ["pm"],
  scope: "project",
  input: z.object({
    automationId: z.string().min(1),
    conflict: ConflictDecision.optional(),
  }),
  handler: async ({ automationId, conflict }, { services, projectId }) =>
    services.automations.run(automationId, { projectId, conflict }),
});

/** `report_triage` (§10 issue triage): what the PM decided, so CodeDen can act on it. */
export const reportTriage = defineTool({
  name: "report_triage",
  description:
    "After classifying a new issue and applying labels/comment with triage_issue, report the decision. For 'ready' issues CodeDen then either starts an agent session (when the project's triage policy allows it) or asks the user 'Should I take this on?' in the inbox. Do not call start_session for triaged issues yourself.",
  roles: ["pm"],
  scope: "project",
  isAvailable: inGithubProject,
  input: TriageReport,
  handler: async (report, { services, projectId }) =>
    services.automations.triage.report(githubProject(services, projectId), report),
});
