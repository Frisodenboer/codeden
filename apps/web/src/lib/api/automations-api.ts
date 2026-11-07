import {
  AutomationListItem,
  AutomationListResponse,
  AutomationProjectSettings,
  AutomationRun,
  type AutomationRunStatus,
  AutomationTemplate,
  type CreateAutomationRequest,
  type RunAutomationRequest,
  RunAutomationResponse,
  ScheduledRun,
  StarterSetResponse,
  type TriageDecisionRequest,
  TriageDecisionResponse,
  UnskipNextResponse,
  type UpdateAutomationRequest,
} from "@codeden/contracts";
import type { z } from "zod";
import type { Fetcher } from "./http";
import { qs } from "./http-features";

/** `POST /api/automations` body before defaults (`enabled` is optional). */
export type CreateAutomationInput = z.input<typeof CreateAutomationRequest>;

/** Filters for the runs history (`GET /api/automations/runs`). */
export interface AutomationRunsQuery {
  projectId?: string;
  automationId?: string;
  status?: AutomationRunStatus;
  limit?: number;
}

/**
 * `/api/automations/*` and `/api/projects/:id/automations/*` (§10, §8.4): definitions, per
 * project state, runs, the upcoming runs of the Now / Next strip, templates and the starter
 * set, and "Should I take this on?" triage decisions.
 */
export interface AutomationsApi {
  list(projectId?: string): Promise<AutomationListResponse>;
  get(automationId: string): Promise<AutomationListItem>;
  create(req: CreateAutomationInput): Promise<AutomationListItem>;
  /** Database automations only (409 `automation_read_only` for file-based ones). */
  update(automationId: string, req: UpdateAutomationRequest): Promise<AutomationListItem>;
  remove(automationId: string): Promise<void>;
  /** With `projectId` on an all-projects automation, sets that project's override. */
  setEnabled(
    automationId: string,
    enabled: boolean,
    projectId?: string,
  ): Promise<AutomationListItem>;
  /** Run now; a `conflict` result means nothing was recorded yet. */
  run(automationId: string, req: RunAutomationRequest): Promise<RunAutomationResponse>;
  pause(automationId: string, projectId: string): Promise<AutomationListItem>;
  resume(automationId: string, projectId: string): Promise<AutomationListItem>;
  skipNext(automationId: string, projectId: string): Promise<ScheduledRun | null>;
  /** Undo a skip; the next run (now not skipped), or null when nothing was skipped. */
  unskipNext(automationId: string, projectId: string): Promise<ScheduledRun | null>;
  /** Drop the project's override of an all-projects automation. */
  clearOverride(automationId: string, projectId: string): Promise<AutomationListItem>;
  runs(query?: AutomationRunsQuery): Promise<AutomationRun[]>;
  /** Queued runs only (409 `not_queued`). */
  cancelRun(runId: string): Promise<AutomationRun>;
  upcoming(projectId?: string, limit?: number): Promise<ScheduledRun[]>;
  templates(): Promise<AutomationTemplate[]>;
  /** Re-read automation files now. */
  reload(): Promise<AutomationListResponse>;
  starterSet(projectId: string, enable: boolean): Promise<StarterSetResponse>;
  projectSettings(projectId: string): Promise<AutomationProjectSettings>;
  setProjectEnabled(projectId: string, enabled: boolean): Promise<AutomationProjectSettings>;
  acceptTriage(itemId: string, req?: TriageDecisionRequest): Promise<TriageDecisionResponse>;
  declineTriage(itemId: string, req?: TriageDecisionRequest): Promise<TriageDecisionResponse>;
}

const enc = encodeURIComponent;

/** The real automations API over the server routes; responses are validated. */
export function httpAutomationsApi(http: Fetcher): AutomationsApi {
  const { get, post, call } = http;
  const one = (v: unknown) => AutomationListItem.parse(v);
  const path = (id: string) => `/automations/${enc(id)}`;
  const projectPath = (id: string) => `/projects/${enc(id)}/automations`;
  return {
    list: (projectId) =>
      get(`/automations${qs({ projectId })}`, (v) => AutomationListResponse.parse(v)),
    get: (id) => get(path(id), one),
    create: (req) => post("/automations", req, one),
    update: (id, req) => call("PATCH", path(id), req, one),
    async remove(id) {
      await call("DELETE", path(id));
    },
    setEnabled: (id, enabled, projectId) =>
      post(`${path(id)}/${enabled ? "enable" : "disable"}`, projectId ? { projectId } : {}, one),
    run: (id, req) => post(`${path(id)}/run`, req, (v) => RunAutomationResponse.parse(v)),
    pause: (id, projectId) => post(`${path(id)}/pause`, { projectId }, one),
    resume: (id, projectId) => post(`${path(id)}/resume`, { projectId }, one),
    skipNext: (id, projectId) =>
      post(`${path(id)}/skip-next`, { projectId }, (v) =>
        ScheduledRun.nullable().parse((v as { skipped: unknown }).skipped),
      ),
    unskipNext: (id, projectId) =>
      post(`${path(id)}/unskip-next`, { projectId }, (v) => UnskipNextResponse.parse(v).next),
    clearOverride: (id, projectId) => post(`${path(id)}/clear-override`, { projectId }, one),
    runs: (q = {}) =>
      get(`/automations/runs${qs({ ...q })}`, (v) => AutomationRun.array().parse(v)),
    cancelRun: (runId) =>
      post(`/automations/runs/${enc(runId)}/cancel`, {}, (v) => AutomationRun.parse(v)),
    upcoming: (projectId, limit) =>
      get(`/automations/upcoming${qs({ projectId, limit })}`, (v) => ScheduledRun.array().parse(v)),
    templates: () => get("/automations/templates", (v) => AutomationTemplate.array().parse(v)),
    reload: () => post("/automations/reload", {}, (v) => AutomationListResponse.parse(v)),
    starterSet: (id, enable) =>
      post(`${projectPath(id)}/starter`, { enable }, (v) => StarterSetResponse.parse(v)),
    projectSettings: (id) =>
      get(`${projectPath(id)}/settings`, (v) => AutomationProjectSettings.parse(v)),
    setProjectEnabled: (id, enabled) =>
      call("PATCH", `${projectPath(id)}/settings`, { enabled }, (v) =>
        AutomationProjectSettings.parse(v),
      ),
    acceptTriage: (itemId, req = {}) =>
      post(`/automations/triage/${enc(itemId)}/accept`, req, (v) =>
        TriageDecisionResponse.parse(v),
      ),
    declineTriage: (itemId, req = {}) =>
      post(`/automations/triage/${enc(itemId)}/decline`, req, (v) =>
        TriageDecisionResponse.parse(v),
      ),
  };
}
