import {
  Automation,
  type AutomationRun,
  InboxItem,
  Project,
  Session,
  type Thread,
  type Turn,
} from "@codeden/contracts";
import type {
  automationRuns,
  automations,
  inboxItems,
  projects,
  sessions,
  threads,
  turns,
} from "./schema";

/** Mapping between contract entities and projection rows. Rows are validated on the way out. */

type ProjectRow = typeof projects.$inferSelect;
type SessionRow = typeof sessions.$inferSelect;
type InboxRow = typeof inboxItems.$inferSelect;
type RunRow = typeof automationRuns.$inferSelect;
type AutomationRow = typeof automations.$inferSelect;

export function projectToRow(p: Project): ProjectRow {
  return {
    id: p.id,
    kind: p.kind,
    name: p.name,
    slug: p.slug,
    path: p.path,
    defaultBranch: p.defaultBranch,
    defaultProvider: p.defaultProvider,
    autonomy: p.autonomy,
    autonomyMode: p.autonomyMode,
    visionPath: p.visionPath,
    factoryLimits: p.factoryLimits,
    killSwitch: p.killSwitch,
    timezone: p.timezone,
    github: p.kind === "github" ? p.github : null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    archivedAt: p.archivedAt,
  };
}

export function rowToProject(r: ProjectRow): Project {
  const { github, factoryLimits, ...rest } = r;
  return Project.parse({
    ...rest,
    factoryLimits: factoryLimits ?? undefined,
    ...(r.kind === "github" ? { github } : {}),
  });
}

export function sessionToRow(s: Session): SessionRow {
  return { ...s };
}

export function rowToSession(r: SessionRow): Session {
  return Session.parse(r);
}

export function inboxToRow(i: InboxItem): InboxRow {
  return { ...i };
}

export function rowToInbox(r: InboxRow): InboxItem {
  return InboxItem.parse(r);
}

export function automationToRow(a: Automation): AutomationRow {
  return { ...a };
}

export function rowToAutomation(r: AutomationRow): Automation {
  return Automation.parse(r);
}

export function runToRow(run: AutomationRun): RunRow {
  return { ...run };
}

export function rowToThread(r: typeof threads.$inferSelect): Thread {
  return r;
}

export function rowToTurn(r: typeof turns.$inferSelect): Turn {
  return { ...r, status: r.status as Turn["status"] };
}
