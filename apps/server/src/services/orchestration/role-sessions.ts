import { type RoleSessionsRef, type Session, StartSessionRequest } from "@codeden/contracts";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../../db/client";
import { rowToSession } from "../../db/rows";
import { sessions } from "../../db/schema";
import { ServiceError } from "../errors";
import type { ProjectService } from "../projects/project-service";
import type { SessionService } from "../sessions/session-service";

export type OrchestrationRole = "orchestrator" | "pm";

/**
 * The long-lived role sessions (§8.1): one orchestrator (cwd `<home>/orchestrator/`) and one
 * PM per project (cwd: the project root, read-only). Created lazily on first use; afterwards
 * the same session is reused and, when the runner no longer hosts it, resumed through its
 * provider resume token. Provider, model and effort come from `settings.providers.<role>`.
 */
export class RoleSessions {
  private readonly creating = new Map<string, Promise<Session>>();

  constructor(
    private readonly deps: { db: Db; sessions: SessionService; projects: ProjectService },
  ) {}

  /** The existing role session (latest), if any. */
  find(role: OrchestrationRole, projectId: string | null): Session | undefined {
    if (role === "pm" && !projectId) return undefined;
    const row = this.deps.db
      .select()
      .from(sessions)
      .where(
        and(
          eq(sessions.role, role),
          role === "orchestrator"
            ? isNull(sessions.projectId)
            : eq(sessions.projectId, projectId as string),
        ),
      )
      .orderBy(desc(sessions.createdAt))
      .limit(1)
      .get();
    return row ? rowToSession(row) : undefined;
  }

  /** Ids of every orchestrator and PM session (to keep them out of work digests). */
  roleSessionIds(): Set<string> {
    const rows = this.deps.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(inArray(sessions.role, ["orchestrator", "pm"]))
      .all();
    return new Set(rows.map((r) => r.id));
  }

  /** Current role sessions, for the snapshot. */
  refs(): RoleSessionsRef {
    const rows = this.deps.db
      .select()
      .from(sessions)
      .where(inArray(sessions.role, ["orchestrator", "pm"]))
      .orderBy(sessions.createdAt)
      .all()
      .map(rowToSession);
    const ref: RoleSessionsRef = { orchestrator: null, pms: {} };
    for (const s of rows) {
      if (s.role === "orchestrator") ref.orchestrator = s.id;
      else if (s.projectId) ref.pms[s.projectId] = s.id;
    }
    return ref;
  }

  /** The role session, created when missing. */
  async ensure(role: OrchestrationRole, projectId: string | null): Promise<Session> {
    const existing = this.find(role, projectId);
    if (existing) return existing;
    const key = `${role}:${projectId ?? ""}`;
    let pending = this.creating.get(key);
    if (!pending) {
      pending = this.create(role, projectId).finally(() => this.creating.delete(key));
      this.creating.set(key, pending);
    }
    return pending;
  }

  private async create(role: OrchestrationRole, projectId: string | null): Promise<Session> {
    const project = role === "pm" && projectId ? this.deps.projects.get(projectId) : null;
    if (role === "pm" && !project) {
      throw new ServiceError(400, "project_required", "A PM needs a project");
    }
    const request = StartSessionRequest.parse({
      projectId: role === "pm" ? (projectId as string) : null,
      role,
      workspace: { mode: "repo_root" },
      purpose: project ? `Project manager for ${project.name}` : "Orchestrator",
      workKey: project ? `pm:${project.slug}` : "orchestrator:main",
      startedBy: { kind: "user" },
      title: project ? `PM · ${project.name}` : "Orchestrator",
      autonomy: "auto",
    });
    const result = await this.deps.sessions.start(request);
    if (result.status !== "started") {
      throw new ServiceError(409, "role_session_conflict", `Could not start the ${role} session`);
    }
    const session = this.find(role, projectId);
    if (!session) throw new ServiceError(500, "role_session_missing", "Role session vanished");
    return session;
  }
}
