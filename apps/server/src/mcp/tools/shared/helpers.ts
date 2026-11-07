import type { Project, Session, WorkSummary } from "@codeden/contracts";
import type { AppServices } from "../../../services/container";
import { ToolError } from "../../define";

/** A project by id, as a tool error when it does not exist or is archived. */
export function projectFor(services: AppServices, projectId: string): Project {
  let project: Project;
  try {
    project = services.projects.get(projectId);
  } catch {
    throw new ToolError(`No project ${projectId}. Call list_projects for the ids.`);
  }
  if (project.archivedAt) throw new ToolError(`Project ${project.name} is archived`);
  return project;
}

/** A GitHub project, or a tool error for local-only projects (no issue/PR flow, §9). */
export function githubProject(services: AppServices, projectId: string): Project {
  const project = projectFor(services, projectId);
  if (project.kind !== "github") {
    throw new ToolError(
      `${project.name} is a local project without a GitHub remote: no issues or PRs.`,
    );
  }
  return project;
}

/** An agent session of the caller's project, or a tool error. */
export function agentSessionOf(
  services: AppServices,
  sessionId: string,
  projectId: string,
): Session {
  const found = services.sessionRepo.find(sessionId)?.session;
  if (found?.role !== "agent" || found.projectId !== projectId) {
    throw new ToolError(
      `No agent session ${sessionId} in this project. Call list_sessions for the ids.`,
    );
  }
  return found;
}

/** A session as tools report it: enough to identify and judge the work. */
export function compactSession(s: Session) {
  return {
    id: s.id,
    title: s.title,
    purpose: s.purpose,
    workKey: s.workKey,
    scope: { paths: s.scope.paths, area: s.scope.area },
    status: s.status,
    progress: s.progress,
    startedBy: s.startedBy,
    provider: s.provider,
    model: s.model,
    branch: s.branch,
    issue: s.issue?.number ?? null,
    pr: s.pr ? { number: s.pr.number, state: s.pr.state, url: s.pr.url } : null,
    result: s.result ? { outcome: s.result.outcome, summary: s.result.summary } : null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** Running or queued work as tools report it. */
export function compactWork(w: WorkSummary) {
  return {
    kind: w.kind,
    id: w.id,
    sessionId: w.sessionId,
    workKey: w.workKey,
    purpose: w.purpose,
    status: w.status,
    progress: w.progress,
    startedBy: w.startedBy,
    startedAt: w.startedAt,
  };
}
