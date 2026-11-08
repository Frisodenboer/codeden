import { randomUUID } from "node:crypto";
import {
  type AgentEventOf,
  agentEventToNewEvent,
  type ConflictRecord,
  messageFrom,
  NOTICE_BATCH_CODE,
  type Notice,
  type Overview,
  type ProjectStatus,
  type QueueSender,
  type RawEventEnvelope,
  type RoleMessageResponse,
  type Session,
  type UserInput,
} from "@codeden/contracts";
import type { Db } from "../../db/client";
import type { EventStore } from "../../events/store";
import { errorMessage, ServiceError } from "../errors";
import type { InboxService } from "../inbox-service";
import type { ProjectService } from "../projects/project-service";
import type { SessionRepo } from "../sessions/repo";
import type { SessionService } from "../sessions/session-service";
import { type AskOutcome, askMarker, finalAssistantMessage, PmAsks } from "./asks";
import { ConflictService } from "./conflicts";
import {
  buildProjectStatus,
  dayAgo,
  renderNotices,
  renderOverviewDigest,
  renderProjectDigest,
  sharedWork,
} from "./digest";
import { deriveGithubNotices, GITHUB_NOTICE_EVENTS } from "./github-notices";
import { ProjectNotes } from "./notes";
import { deriveNotices, type NoticeDraft, NoticeStore } from "./notices";
import {
  type AutomationPort,
  type GithubPort,
  UnavailableAutomationPort,
  UnavailableGithubPort,
} from "./ports";
import { type OrchestrationRole, RoleSessions } from "./role-sessions";
import { type WakeResult, WakeScheduler, type WakeSchedulerOptions } from "./wake-scheduler";

export interface OrchestrationOptions {
  wake?: WakeSchedulerOptions;
  /** Default `ask_pm` wait (3 minutes). */
  askTimeoutMs?: number;
}

export interface OrchestrationDeps {
  db: Db;
  store: EventStore;
  repo: SessionRepo;
  sessions: SessionService;
  projects: ProjectService;
  inbox: InboxService;
  github?: GithubPort;
  automation?: AutomationPort;
  options?: OrchestrationOptions;
  log?: (message: string) => void;
}

const NOT_READY = new Set(["created", "queued", "starting", "running", "waiting"]);

const WAKE_TEXT =
  "Automatic wake-up for the updates above. Act on anything that needs it; otherwise reply in one short line.";

/**
 * Orchestration (§8): the orchestrator and PM sessions, the status digest injected on every
 * wake, typed notices batched into debounced wakes with a loop guard, PM <-> orchestrator
 * messaging (`ask_pm` waits for the answer), persisted conflicts and project notes.
 */
export class OrchestrationService {
  readonly roles: RoleSessions;
  readonly notices: NoticeStore;
  readonly conflicts: ConflictService;
  readonly notes: ProjectNotes;
  readonly asks: PmAsks;
  readonly github: GithubPort;
  readonly automation: AutomationPort;
  readonly wakes: WakeScheduler;
  /** Notices to show as cards in the next turn of a role session. */
  private readonly pendingCards = new Map<string, Notice[]>();
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly deps: OrchestrationDeps) {
    this.roles = new RoleSessions(deps);
    this.notices = new NoticeStore(deps.db, deps.store);
    this.notes = new ProjectNotes(deps.projects);
    this.github = deps.github ?? new UnavailableGithubPort();
    this.automation = deps.automation ?? new UnavailableAutomationPort();
    this.conflicts = new ConflictService({
      ...deps,
      onRecorded: (record) => this.onConflict(record),
    });
    this.asks = new PmAsks({
      db: deps.db,
      onLateReply: (reply) =>
        this.postToOrchestrator(
          reply.projectId,
          reply.pmSessionId,
          `Answer to your earlier ask_pm question:\n${reply.text}`,
          false,
        ),
    });
    this.wakes = new WakeScheduler((key) => this.fire(key), {
      ...deps.options?.wake,
      onSuppressed: (key, until) =>
        deps.log?.(
          `orchestration: loop guard holds wakes for ${key} until ${new Date(until).toISOString()}`,
        ),
      onGaveUp: (key) =>
        deps.log?.(
          `orchestration: ${key} stayed busy; its notices wait for its next message or notice`,
        ),
    });
  }

  start(): void {
    this.unsubscribe = this.deps.store.subscribe((events) => this.onEvents(events));
    this.deps.sessions.setInputDecorator((session, input) => this.decorate(session, input));
  }

  stop(): void {
    this.unsubscribe?.();
    this.wakes.dispose();
  }

  // ---------------------------------------------------------------- digest

  projectStatus(projectId: string): ProjectStatus {
    const project = this.deps.projects.get(projectId);
    const roleIds = this.roles.roleSessionIds();
    return buildProjectStatus({
      project,
      work: this.deps.repo
        .activeWork(projectId)
        .filter((w) => !(w.sessionId && roleIds.has(w.sessionId))),
      scheduled: this.automation.listScheduledRuns(projectId, 5),
      inbox: this.deps.inbox.list({ projectId }),
      outcomes: this.notices.recent(projectId, ["session.finished", "session.failed"], dayAgo()),
    });
  }

  overview(): Overview {
    const projects = this.deps.projects.list().map((p) => this.projectStatus(p.id));
    const pmMessages = this.notices
      .undelivered("orchestrator", null)
      .flatMap((n) =>
        n.type === "pm.message" && n.data.informational
          ? [{ projectId: n.projectId, text: n.data.text, at: n.createdAt }]
          : [],
      );
    return {
      generatedAt: new Date().toISOString(),
      projects,
      sharedWork: sharedWork(projects),
      pmMessages,
    };
  }

  /** The digest text for a role session's next turn. */
  digestFor(session: Session): string {
    if (session.role === "pm" && session.projectId) {
      return renderProjectDigest(this.projectStatus(session.projectId));
    }
    return renderOverviewDigest({ ...this.overview(), pmMessages: [] });
  }

  /**
   * Prepend the status digest and any undelivered notices to a role session's input (§8.4).
   * Runs at send time, so queued messages get a fresh digest too.
   */
  decorate(session: Session, input: UserInput): UserInput {
    if (session.role === "agent") return input;
    try {
      const parts = [this.digestFor(session)];
      const target = session.role === "pm" ? "pm" : "orchestrator";
      const pending = this.notices.undelivered(
        target,
        session.role === "pm" ? session.projectId : null,
      );
      if (pending.length > 0) {
        parts.push(renderNotices(pending, (id) => this.projectName(id)));
        this.notices.markDelivered(pending.map((n) => n.id));
        this.pendingCards.set(session.id, [
          ...(this.pendingCards.get(session.id) ?? []),
          ...pending,
        ]);
      }
      parts.push(input.text);
      return { ...input, text: parts.join("\n\n") };
    } catch (error) {
      this.deps.log?.(`orchestration digest: ${errorMessage(error)}`);
      return input;
    }
  }

  // ---------------------------------------------------------------- messaging

  /**
   * Send a message to the orchestrator or a project's PM, creating the session if needed.
   * `from` labels the message in the queue tray when it has to wait for a running turn.
   */
  async sendToRole(
    role: OrchestrationRole,
    projectId: string | null,
    input: UserInput,
    whenBusy: "queue" | "steer" | "reject" = "queue",
    from: QueueSender = "user",
  ): Promise<RoleMessageResponse> {
    const session = await this.roles.ensure(role, projectId);
    const res = await this.deps.sessions.send(session.id, { input, whenBusy }, from);
    return { sessionId: session.id, status: res.status };
  }

  /** `message_pm`: hand a PM a task without waiting. */
  async messagePm(projectId: string, text: string): Promise<RoleMessageResponse> {
    this.guard(`pm:${projectId}`);
    return this.sendToRole(
      "pm",
      projectId,
      messageFrom("orchestrator", text),
      "queue",
      "orchestrator",
    );
  }

  /** `ask_pm`: ask a PM and wait (up to `timeoutMs`) for the answer. */
  async askPm(
    projectId: string,
    question: string,
    opts: { fromSessionId: string | null; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<AskOutcome & { pmSessionId: string }> {
    this.guard(`pm:${projectId}`);
    const pm = await this.roles.ensure("pm", projectId);
    const askId = randomUUID().slice(0, 8);
    this.asks.register(askId, { pmSessionId: pm.id, projectId, fromSessionId: opts.fromSessionId });
    const answer = this.asks.wait(
      askId,
      opts.timeoutMs ?? this.deps.options?.askTimeoutMs ?? 180_000,
      opts.signal,
    );
    const text = [
      `Question from the orchestrator ${askMarker(askId)}:`,
      question,
      "",
      "Answer in your final message of this turn: it is returned to the orchestrator directly.",
    ].join("\n");
    await this.deps.sessions.send(
      pm.id,
      { input: { text, attachments: [] }, whenBusy: "queue" },
      "orchestrator",
    );
    return { ...(await answer), pmSessionId: pm.id };
  }

  /** `message_orchestrator`: a PM reports; informational messages never wake the orchestrator. */
  messageOrchestrator(
    pm: Session,
    text: string,
    opts: { informational: boolean; replyTo?: string },
  ): "answered" | "queued" | "noted" {
    if (opts.replyTo && this.asks.answer(opts.replyTo, text)) return "answered";
    this.postToOrchestrator(pm.projectId, pm.id, text, opts.informational);
    return opts.informational ? "noted" : "queued";
  }

  /** Record a notice (other services: GitHub checks, automations); wakes its target when asked. */
  notify(draft: NoticeDraft, wake = true): Notice | undefined {
    const created = this.notices.create(draft);
    if (created && wake) this.wakes.request(wakeKey(created.target, created.projectId));
    return created;
  }

  // ---------------------------------------------------------------- internals

  private postToOrchestrator(
    projectId: string | null,
    fromSessionId: string,
    text: string,
    informational: boolean,
  ): void {
    const name = projectId ? this.projectName(projectId) : "a project";
    this.notify(
      {
        id: `pm.message:${randomUUID()}`,
        type: "pm.message",
        projectId,
        target: "orchestrator",
        sessionId: fromSessionId,
        title: `${informational ? "Update" : "Message"} from the PM of ${name}`,
        data: { fromSessionId, text, informational },
      },
      !informational,
    );
  }

  private onConflict(record: ConflictRecord): void {
    if (!record.projectId) return;
    this.notify({
      id: `conflict:${record.id}`,
      type: "conflict",
      projectId: record.projectId,
      target: "pm",
      sessionId: record.existing[0]?.sessionId ?? null,
      title: `Conflict: ${record.request.purpose}`,
      data: {
        conflictId: record.id,
        workKey: record.request.workKey,
        purpose: record.request.purpose,
        requestedBy: record.request.startedBy,
        existing: record.existing,
      },
    });
  }

  private guard(key: string): void {
    if (!this.wakes.allowed(key)) {
      throw new ServiceError(
        409,
        "loop_guard",
        "Too many messages to this session recently (loop guard). Wait a few minutes or ask the user.",
      );
    }
    this.wakes.recordWake(key);
  }

  private onEvents(events: RawEventEnvelope[]): void {
    this.asks.onEvents(events);
    const relevant = events.some(
      (e) =>
        e.type === "agent.turn.completed" ||
        e.type === "agent.turn.started" ||
        e.type === "inbox.created" ||
        e.type === "session.updated" ||
        e.type === "automation_run.updated" ||
        GITHUB_NOTICE_EVENTS.has(e.type),
    );
    if (!relevant) return;
    setImmediate(() => {
      try {
        this.attachCards(events);
        const session = (id: string) => this.deps.repo.find(id)?.session;
        const derived = [
          ...deriveNotices(events, {
            session,
            finalMessage: (sessionId, turnId) =>
              finalAssistantMessage(this.deps.db, sessionId, turnId),
          }),
          ...deriveGithubNotices(events, session),
        ];
        for (const { notice, wake } of derived) this.notify(notice, wake);
      } catch (error) {
        this.deps.log?.(`orchestration notices: ${errorMessage(error)}`);
      }
    });
  }

  /** Show the notices a wake delivered as cards at the start of the role session's turn. */
  private attachCards(events: RawEventEnvelope[]): void {
    for (const e of events) {
      if (e.type !== "agent.turn.started" || !e.sessionId) continue;
      const cards = this.pendingCards.get(e.sessionId);
      if (!cards) continue;
      this.pendingCards.delete(e.sessionId);
      const event = e.payload as AgentEventOf<"turn.started">;
      this.deps.store.append([
        agentEventToNewEvent(e.sessionId, {
          type: "item.completed",
          threadId: event.threadId,
          turnId: event.turnId,
          item: {
            id: `notices-${event.turnId}`,
            kind: "notice",
            status: "completed",
            level: "info",
            code: NOTICE_BATCH_CODE,
            message: `${cards.length} update${cards.length === 1 ? "" : "s"} since the last turn`,
            data: JSON.parse(JSON.stringify({ notices: cards })),
          },
        }),
      ]);
    }
  }

  /** Deliver pending notices to their target with one wake (called by the scheduler). */
  private async fire(key: string): Promise<WakeResult> {
    const role: OrchestrationRole = key === "orchestrator" ? "orchestrator" : "pm";
    const projectId = role === "pm" ? key.slice(3) : null;
    if (this.notices.undelivered(role, projectId).length === 0) return "empty";
    const session = await this.roles.ensure(role, projectId);
    if (NOT_READY.has(session.status)) return "busy";
    await this.deps.sessions.send(
      session.id,
      { input: { text: WAKE_TEXT, attachments: [] }, whenBusy: "reject" },
      "codeden",
    );
    return "sent";
  }

  private projectName(id: string): string {
    try {
      return this.deps.projects.get(id).name;
    } catch {
      return id;
    }
  }
}

/** Scheduler key of a notice target. */
export function wakeKey(target: "pm" | "orchestrator", projectId: string | null): string {
  return target === "orchestrator" ? "orchestrator" : `pm:${projectId ?? ""}`;
}
