import { randomUUID } from "node:crypto";
import {
  Automation,
  AutomationGuards,
  type AutomationTemplate,
  type CreateAutomationRequest,
  type UpdateAutomationRequest,
  WorkKey,
} from "@codeden/contracts";
import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { rowToAutomation } from "../../db/rows";
import { automations } from "../../db/schema";
import type { EventStore } from "../../events/store";
import { badRequest, conflict, notFound } from "../errors";
import type { ProjectService } from "../projects/project-service";
import { cronError, isValidTimezone } from "./cron";
import type { ScheduleStore } from "./schedule-store";
import { type AutomationSources, templateFits } from "./sources";

export interface DefinitionsDeps {
  db: Db;
  store: EventStore;
  projects: ProjectService;
  sources: AutomationSources;
  schedules: ScheduleStore;
}

/** Id of a project's starter automation created from a template. */
export function starterId(projectId: string, templateId: string): string {
  return `starter:${projectId}:${templateId}`;
}

/** Reject cron expressions croner cannot parse, unknown timezones and malformed work keys. */
export function validateAutomation(a: Automation): void {
  if (a.trigger.type === "cron") {
    if (a.trigger.timezone && !isValidTimezone(a.trigger.timezone)) {
      throw badRequest(`Unknown timezone ${a.trigger.timezone}`, "invalid_timezone");
    }
    const error = cronError(a.trigger.expression, a.trigger.timezone);
    if (error) throw badRequest(`Invalid cron expression: ${error}`, "invalid_cron");
  }
  if (a.workKey && !a.workKey.includes("{{") && !WorkKey.safeParse(a.workKey).success) {
    throw badRequest(
      "workKey must look like <kind>:<id>, e.g. automation:audit",
      "invalid_work_key",
    );
  }
  if (a.action.type === "triage" && a.trigger.type === "cron") {
    throw badRequest("Triage runs on issue events, not on a schedule", "invalid_trigger");
  }
}

/**
 * Database-stored automations (§10): create (from a template or from scratch), update,
 * delete, enable and disable, and the starter set offered to new projects. File-based
 * automations are read-only here except for their enabled switch.
 */
export class AutomationDefinitions {
  constructor(private readonly deps: DefinitionsDeps) {}

  all(): Automation[] {
    return this.deps.db.select().from(automations).all().map(rowToAutomation);
  }

  find(id: string): Automation | undefined {
    const row = this.deps.db.select().from(automations).where(eq(automations.id, id)).get();
    return row ? rowToAutomation(row) : undefined;
  }

  get(id: string): Automation {
    const a = this.find(id);
    if (!a) throw notFound(`No automation ${id}`, "automation_not_found");
    return a;
  }

  create(req: CreateAutomationRequest, id: string = randomUUID()): Automation {
    const template = req.templateId ? this.template(req.templateId) : undefined;
    if (req.projectId) this.deps.projects.get(req.projectId);
    const now = new Date().toISOString();
    const trigger = req.trigger ?? template?.trigger;
    const action = req.action ?? template?.action;
    const name = req.name ?? template?.name;
    if (!trigger || !action || !name) throw badRequest("name, trigger and action are required");
    const automation = Automation.parse({
      id,
      name,
      description:
        req.description !== undefined ? req.description : (template?.description ?? null),
      enabled: req.enabled,
      source: "database",
      templateId: template?.id ?? null,
      trigger,
      action,
      target: req.projectId
        ? { type: "project", projectId: req.projectId }
        : { type: "all_projects" },
      guards: AutomationGuards.parse({ ...template?.guards, ...req.guards }),
      workKey: req.workKey ?? template?.workKey,
      createdAt: now,
      updatedAt: now,
    });
    validateAutomation(automation);
    return this.save(automation);
  }

  update(id: string, req: UpdateAutomationRequest): Automation {
    const current = this.editable(id);
    if (req.target?.type === "project") this.deps.projects.get(req.target.projectId);
    const { workKey: _drop, ...rest } = current;
    const workKey = req.workKey === null ? undefined : (req.workKey ?? current.workKey);
    const next = Automation.parse({
      ...rest,
      ...(req.name !== undefined ? { name: req.name } : {}),
      ...(req.description !== undefined ? { description: req.description } : {}),
      ...(req.trigger ? { trigger: req.trigger } : {}),
      ...(req.action ? { action: req.action } : {}),
      ...(req.target ? { target: req.target } : {}),
      guards: AutomationGuards.parse({ ...current.guards, ...req.guards }),
      ...(workKey ? { workKey } : {}),
      updatedAt: new Date().toISOString(),
    });
    validateAutomation(next);
    return this.save(next);
  }

  remove(id: string): void {
    this.editable(id);
    this.deps.store.append([
      { type: "automation.deleted", sessionId: null, payload: { automationId: id } },
    ]);
    this.deps.schedules.removeAutomation(id);
  }

  /**
   * Enable or disable. With `projectId` on an automation that targets all projects, only that
   * project's override changes; otherwise the automation's own switch.
   */
  setEnabled(id: string, enabled: boolean, projectId?: string): Automation {
    const a = this.get(id);
    if (projectId) this.deps.projects.get(projectId);
    if (projectId && a.target.type === "all_projects") {
      this.deps.schedules.upsert(id, projectId, { enabledOverride: enabled });
      return a;
    }
    if (projectId && a.target.type === "project" && a.target.projectId !== projectId) {
      throw notFound(`Automation ${id} does not belong to that project`, "automation_not_found");
    }
    if (a.enabled === enabled) return a;
    return this.save({ ...a, enabled, updatedAt: new Date().toISOString() });
  }

  /** Drop a project's override of an all-projects automation; it follows its own switch again. */
  clearOverride(id: string, projectId: string): Automation {
    const a = this.get(id);
    this.deps.projects.get(projectId);
    if (a.target.type !== "all_projects") {
      throw conflict("Only automations for all projects have per-project overrides", "no_override");
    }
    this.deps.schedules.upsert(id, projectId, { enabledOverride: null });
    return a;
  }

  /**
   * Create the project's starter set (§10) from the starter templates that fit the project,
   * keeping existing ones; with `enable`, switch them all on.
   */
  starterSet(projectId: string, enable: boolean): Automation[] {
    const project = this.deps.projects.get(projectId);
    const out: Automation[] = [];
    for (const template of this.deps.sources.templates()) {
      if (!template.starter || template.source !== "builtin" || !templateFits(template, project)) {
        continue;
      }
      const id = starterId(projectId, template.id);
      const existing = this.find(id);
      if (existing) {
        out.push(enable ? this.setEnabled(id, true) : existing);
        continue;
      }
      out.push(this.create({ templateId: template.id, projectId, enabled: enable }, id));
    }
    return out;
  }

  private template(id: string): AutomationTemplate {
    const template = this.deps.sources.template(id);
    if (!template) throw notFound(`No automation template ${id}`, "template_not_found");
    return template;
  }

  private editable(id: string): Automation {
    const a = this.get(id);
    if (a.source !== "database") {
      throw conflict(
        "This automation is defined in a file; edit the file instead",
        "automation_read_only",
      );
    }
    return a;
  }

  private save(automation: Automation): Automation {
    this.deps.store.append([
      { type: "automation.saved", sessionId: null, payload: { automation } },
    ]);
    return automation;
  }
}
