import type { Session } from "@codeden/contracts";

/** Which of a project's sessions the project home lists. */
export type SessionView = "active" | "archived";

const agentsOf = (sessions: readonly Session[], projectId: string) =>
  sessions.filter((s) => s.projectId === projectId && s.role === "agent");

/** A project's agent sessions in one view, most recently updated first. */
export function sessionsInView(
  sessions: readonly Session[],
  projectId: string,
  view: SessionView,
): Session[] {
  return agentsOf(sessions, projectId)
    .filter((s) => Boolean(s.archivedAt) === (view === "archived"))
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/** How many of a project's agent sessions are active and archived. */
export function sessionCounts(
  sessions: readonly Session[],
  projectId: string,
): Record<SessionView, number> {
  const agents = agentsOf(sessions, projectId);
  const archived = agents.filter((s) => s.archivedAt).length;
  return { active: agents.length - archived, archived };
}
