import type {
  AutomationListItem,
  AutomationState,
  EventEnvelope,
  RunAutomationResponse,
} from "@codeden/contracts";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useClient } from "./api";
import type { AutomationRunsQuery } from "./api/automations-api";

/** Query keys of the automations views; all start with `automations`. */
export const automationKeys = {
  all: ["automations"] as const,
  list: (projectId?: string) => ["automations", "list", projectId ?? "all"] as const,
  item: (id: string) => ["automations", "item", id] as const,
  runs: (q: AutomationRunsQuery) => ["automations", "runs", q] as const,
  upcoming: (projectId?: string) => ["automations", "upcoming", projectId ?? "all"] as const,
  templates: ["automations", "templates"] as const,
  settings: (projectId: string) => ["automations", "settings", projectId] as const,
};

const AUTOMATION_EVENTS = new Set<string>([
  "automation.saved",
  "automation.deleted",
  "automation.updated",
  "automation_run.updated",
  "settings.updated",
  "project.created",
  "project.updated",
]);

/** Refetch automation views when definitions, schedule state or runs change (§10). */
export function invalidateAutomations(queryClient: QueryClient, env: EventEnvelope): void {
  if (!AUTOMATION_EVENTS.has(env.type)) return;
  void queryClient.invalidateQueries({ queryKey: automationKeys.all });
  // The PM digest and Now / Next include the next scheduled runs.
  if (env.type !== "automation.saved") {
    void queryClient.invalidateQueries({ queryKey: ["project-status"] });
  }
}

export function useAutomations(projectId?: string) {
  const client = useClient();
  return useQuery({
    queryKey: automationKeys.list(projectId),
    queryFn: () => client.automations.list(projectId),
  });
}

export function useAutomation(automationId: string) {
  const client = useClient();
  return useQuery({
    queryKey: automationKeys.item(automationId),
    queryFn: () => client.automations.get(automationId),
  });
}

export function useAutomationRuns(q: AutomationRunsQuery) {
  const client = useClient();
  return useQuery({
    queryKey: automationKeys.runs(q),
    queryFn: () => client.automations.runs(q),
  });
}

/** Upcoming scheduled runs (the "Next" of Now / Next), soonest first. */
export function useUpcomingRuns(projectId?: string) {
  const client = useClient();
  return useQuery({
    queryKey: automationKeys.upcoming(projectId),
    queryFn: () => client.automations.upcoming(projectId, 20),
    // Countdowns and the scheduler's own advances stay fresh even without events.
    refetchInterval: 60_000,
  });
}

export function useAutomationTemplates() {
  const client = useClient();
  return useQuery({
    queryKey: automationKeys.templates,
    queryFn: () => client.automations.templates(),
    staleTime: 60_000,
  });
}

export function useProjectAutomationSettings(projectId: string) {
  const client = useClient();
  return useQuery({
    queryKey: automationKeys.settings(projectId),
    queryFn: () => client.automations.projectSettings(projectId),
  });
}

/** The automation's state in one project (the first state when no project is given). */
export function stateIn(item: AutomationListItem, projectId?: string): AutomationState | null {
  return item.states.find((s) => !projectId || s.projectId === projectId) ?? null;
}

/**
 * The switch shown for an automation in a project: its own switch, or for an all-projects
 * automation the project's override when set.
 */
export function switchValue(item: AutomationListItem, projectId?: string): boolean {
  const state = stateIn(item, projectId);
  if (item.automation.target.type === "all_projects" && state?.enabledOverride != null)
    return state.enabledOverride;
  return item.automation.enabled;
}

/** Toast text for a run-now result that is not a conflict. */
export function runResultText(res: RunAutomationResponse): string {
  switch (res.status) {
    case "started":
      return "Run started";
    case "queued":
      return "Queued behind running work";
    case "skipped":
      return "Skipped";
    case "joined":
      return "Sent to the running session";
    case "conflict":
      return "Matching work is already running";
  }
}
