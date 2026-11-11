import { pathToFileURL } from "node:url";
import type {
  AgentEvent,
  ApprovalAction,
  AutonomyLevel,
  ItemOf,
  ReasoningEffort,
  RuntimeResponse,
  SessionOptions,
  UserInput,
} from "@codeden/contracts";
import { type ProviderSession, ProviderSessionError, type SessionConfigChange } from "../adapter";
import { ApprovalBroker } from "../approvals";
import { AsyncQueue } from "../async-queue";
import { interruptWithDeadline } from "../util/interrupt";
import { explicitModel } from "../util/model";
import { shorten } from "../util/text";
import { type OpencodeClient, OpencodeHttpError } from "./client";
import { parseSlashCommand } from "./commands";
import { OpencodeEventMapper } from "./mapper";
import { splitOpencodeModel } from "./models";
import {
  decidePermission,
  opencodeMcpConfig,
  opencodeMcpName,
  opencodePermissions,
  type PermissionDecision,
} from "./policy";
import type { OpencodeServer } from "./process";
import {
  eventSessionId,
  type OcEvent,
  type OcPartInput,
  type OcPermissionRequest,
  type OcQuestionRequest,
} from "./types";

export interface OpencodeSessionConfig {
  /** The shared server (or anything that hands out clients the same way, in tests). */
  server: Pick<OpencodeServer, "client" | "running" | "onExit">;
  /** Reasoning efforts a model offers (its opencode variants), when known. */
  modelEfforts?: (model: string) => readonly ReasoningEffort[] | undefined;
  /** Context window of a model, for the context meter. */
  contextWindow?: (model: string) => number | undefined;
  interruptTimeoutMs?: number;
  /** Wait before reconnecting a dropped event stream. */
  reconnectDelayMs?: number;
}

/** CodeBench input -> opencode prompt parts. Paths become `file://` URLs. */
export function toOpencodeParts(input: UserInput): OcPartInput[] {
  const parts: OcPartInput[] = [{ type: "text", text: input.text }];
  for (const a of input.attachments) {
    if (a.type === "file") {
      parts.push({
        type: "file",
        mime: a.mediaType ?? "text/plain",
        url: pathToFileURL(a.path).href,
        filename: a.name ?? a.path,
      });
      continue;
    }
    const src = a.source;
    if (src.type === "base64") {
      parts.push({
        type: "file",
        mime: a.mediaType,
        url: `data:${a.mediaType};base64,${src.data}`,
        ...(a.name ? { filename: a.name } : {}),
      });
    } else if (src.type === "path") {
      parts.push({
        type: "file",
        mime: a.mediaType,
        url: pathToFileURL(src.path).href,
        filename: a.name ?? src.path,
      });
    } else {
      throw new Error("Artifact attachments must be resolved to a path or base64 before sending");
    }
  }
  return parts;
}

const ACTIONS: Record<string, ApprovalAction> = {
  edit: "file_change",
  write: "file_change",
  bash: "command",
  webfetch: "network",
  websearch: "network",
  external_directory: "outside_worktree",
};

/** An opencode permission request as a CodeBench approval item. */
export function approvalItem(
  req: OcPermissionRequest,
  toolCallItemId: string | undefined,
): ItemOf<"approval_request"> {
  const meta = req.metadata ?? {};
  const command = typeof meta.command === "string" ? meta.command : undefined;
  const file = typeof meta.filepath === "string" ? meta.filepath : undefined;
  const action = ACTIONS[req.permission] ?? "tool";
  const subject = command ?? file ?? req.patterns.join(", ");
  const title =
    action === "command"
      ? `Run ${shorten(subject, 100)}`
      : action === "file_change"
        ? `Edit ${shorten(subject, 100)}`
        : action === "network"
          ? `Fetch ${shorten(subject, 100)}`
          : action === "outside_worktree"
            ? `Access outside the worktree: ${shorten(subject, 80)}`
            : `Allow ${req.permission}${subject ? `: ${shorten(subject, 80)}` : ""}`;
  return {
    id: `approval-${req.id}`,
    kind: "approval_request",
    status: "in_progress",
    requestId: req.id,
    action,
    title,
    ...(command ? { command } : {}),
    ...(file
      ? { paths: [file] }
      : req.patterns.length && action !== "command"
        ? { paths: req.patterns }
        : {}),
    toolName: req.permission,
    ...(toolCallItemId ? { toolCallItemId } : {}),
    options: ["allow_once", "allow_session", "deny"],
  };
}

/** An opencode question request as a CodeBench user question item. */
export function questionItem(req: OcQuestionRequest): ItemOf<"user_question"> {
  return {
    id: `question-${req.id}`,
    kind: "user_question",
    status: "in_progress",
    requestId: req.id,
    questions: req.questions.map((q, i) => ({
      id: `q${i}`,
      ...(q.header ? { header: q.header } : {}),
      question: q.question,
      options: q.options.map((o) => ({
        label: o.label,
        ...(o.description ? { description: o.description } : {}),
      })),
      multiSelect: q.multiple ?? false,
      allowFreeText: q.custom !== false,
    })),
  };
}

/**
 * A CodeBench session on an opencode session, through the runner's shared `opencode serve`.
 * Events come from the server's per-directory event stream, filtered to this session; the
 * opencode session id is the resume token. If the server exits, the running turn fails as
 * transient and the next `send()` starts the server again.
 */
export class OpencodeSession implements ProviderSession {
  readonly events = new AsyncQueue<AgentEvent>();
  private readonly mapper: OpencodeEventMapper;
  private readonly broker: ApprovalBroker;
  private readonly stream = new AbortController();
  private nextTurn: SessionConfigChange = {};
  private closed = false;
  private unsubscribeExit: (() => void) | undefined;
  private onConnected: (() => void) | undefined;
  /** Current permission level; applies from the next permission request (live). */
  private autonomy: AutonomyLevel;
  /** The session's MCP servers as registered in opencode (per-session names). */
  private readonly mcp: {
    name: string;
    server: string;
    trusted: boolean;
    config: Record<string, unknown>;
  }[];
  /** The server client the MCP servers were registered with (a restarted server forgets). */
  private setUpWith: OpencodeClient | undefined;

  constructor(
    private readonly opts: SessionOptions,
    private readonly config: OpencodeSessionConfig,
  ) {
    const emit = (event: AgentEvent) => this.events.push(event);
    this.autonomy = opts.autonomy;
    this.mcp = opts.mcpServers.map((s) => ({
      name: opencodeMcpName(s.name, opts.sessionId),
      server: s.name,
      trusted: s.transport === "http" ? (s.trusted ?? false) : false,
      config: opencodeMcpConfig(s),
    }));
    this.mapper = new OpencodeEventMapper(opts.sessionId, emit, {
      mcpServers: this.mcp.map((m) => ({ name: m.name, server: m.server })),
      ...(config.contextWindow ? { contextWindow: config.contextWindow } : {}),
    });
    this.broker = new ApprovalBroker(emit);
  }

  /** Start the server (if needed), the event stream and the opencode session. */
  async start(): Promise<void> {
    this.events.push({ type: "thread.started", thread: { id: this.mapper.rootThreadId } });
    this.unsubscribeExit = this.config.server.onExit((code, stderr) =>
      this.onServerExit(code, stderr),
    );
    const client = await this.config.server.client();
    await this.openStream();
    await this.registerMcp(client);
    const session = await this.openOpencodeSession(client);
    this.mapper.opencodeSessionId = session.id;
    this.events.push({
      type: "session.updated",
      resumeToken: session.id,
      ...(session.model ? { model: `${session.model.providerID}/${session.model.id}` } : {}),
    });
  }

  resumeToken(): string | undefined {
    return this.mapper.opencodeSessionId;
  }

  /**
   * The permission level from the next permission request on, running turn included: CodeBench
   * answers every request itself (`./policy`), so nothing in opencode has to change.
   */
  async setAutonomy(level: AutonomyLevel): Promise<void> {
    this.autonomy = level;
  }

  /** Model/effort from the next prompt on (opencode takes both per prompt). */
  async configure(change: SessionConfigChange): Promise<void> {
    this.nextTurn = { ...this.nextTurn, ...change };
  }

  async send(input: UserInput): Promise<void> {
    if (this.closed) throw new ProviderSessionError("closed", "Session is closed");
    if (this.mapper.currentTurnId) {
      throw new ProviderSessionError("turn_running", "A turn is already running");
    }
    const id = this.sessionId();
    const parts = toOpencodeParts(input);
    const modelId = explicitModel(
      this.nextTurn.model !== undefined ? this.nextTurn.model : this.opts.model,
    );
    const model = modelId ? splitOpencodeModel(modelId) : undefined;
    const effort =
      this.nextTurn.effort !== undefined ? (this.nextTurn.effort ?? undefined) : this.opts.effort;
    const supported = modelId ? this.config.modelEfforts?.(modelId) : undefined;
    const variant = effort && supported?.includes(effort) ? effort : undefined;
    const turnId = this.mapper.beginTurn();
    try {
      const client = await this.config.server.client();
      if (this.streamDown) await this.openStream();
      if (this.setUpWith !== client) await this.registerMcp(client);
      const slash = parseSlashCommand(input.text);
      if (slash && (await this.isCommand(client, slash.name))) {
        // `command` answers only when the turn is over; events report it as it runs.
        void client
          .command(this.opts.cwd, id, {
            command: slash.name,
            arguments: slash.args,
            ...(model ? { model: `${model.providerID}/${model.modelID}` } : {}),
            ...(variant ? { variant } : {}),
            parts: parts.filter((p): p is Extract<typeof p, { type: "file" }> => p.type === "file"),
          })
          .catch((error: unknown) => this.commandFailed(turnId, error));
        return;
      }
      await client.prompt(this.opts.cwd, id, {
        parts,
        ...(model ? { model } : {}),
        ...(variant ? { variant } : {}),
        // Appended to opencode's own system prompt (role, CodeBench tools, follow-ups).
        ...(this.opts.systemPrompt ? { system: this.opts.systemPrompt } : {}),
      });
    } catch (error) {
      if (this.mapper.currentTurnId === turnId) {
        const message = error instanceof Error ? error.message : String(error);
        this.mapper.endTurn({
          type: "failed",
          code: error instanceof OpencodeHttpError ? `http_${error.status}` : "prompt_failed",
          message: `opencode did not accept the message: ${message}`.slice(0, 1000),
          kind: "transient",
        });
      }
    }
  }

  /** Abort the running prompt; if opencode does not end it in time, close it anyway. */
  async interrupt(): Promise<void> {
    const turnId = this.mapper.currentTurnId;
    const id = this.mapper.opencodeSessionId;
    if (!turnId || !id) return;
    this.broker.cancelAll();
    this.mapper.markAborted();
    await interruptWithDeadline(
      async () => (await this.config.server.client()).abort(this.opts.cwd, id),
      this.config.interruptTimeoutMs ?? 10_000,
      () => {
        if (this.mapper.currentTurnId === turnId) this.mapper.endTurn({ type: "interrupted" });
      },
    );
  }

  async respond(requestId: string, response: RuntimeResponse): Promise<void> {
    this.broker.respond(requestId, response);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.broker.cancelAll();
    const id = this.mapper.opencodeSessionId;
    if (this.mapper.currentTurnId && id && this.config.server.running) {
      this.config.server.client().then(
        (c) => c.abort(this.opts.cwd, id).catch(() => undefined),
        () => undefined,
      );
    }
    this.mapper.endTurn({ type: "interrupted" });
    this.unsubscribeExit?.();
    this.stream.abort();
    this.events.close();
    const client = this.setUpWith;
    if (client && this.config.server.running) {
      for (const m of this.mcp) {
        void client.disconnectMcp(this.opts.cwd, m.name).catch(() => undefined);
      }
    }
  }

  // ---------------------------------------------------------------- internals

  private commandNames: Promise<Set<string>> | undefined;

  /** True when `name` is one of opencode's slash commands in this folder (asked once). */
  private async isCommand(client: OpencodeClient, name: string): Promise<boolean> {
    this.commandNames ??= client.commands(this.opts.cwd).then(
      (list) => new Set(list.map((c) => c.name)),
      () => new Set<string>(),
    );
    return (await this.commandNames).has(name);
  }

  private commandFailed(turnId: string, error: unknown): void {
    if (this.mapper.currentTurnId !== turnId) return;
    const message = error instanceof Error ? error.message : String(error);
    this.mapper.endTurn({
      type: "failed",
      code: error instanceof OpencodeHttpError ? `http_${error.status}` : "command_failed",
      message: `opencode could not run the command: ${message}`.slice(0, 1000),
      kind: "fatal",
    });
  }

  private sessionId(): string {
    const id = this.mapper.opencodeSessionId;
    if (!id) throw new ProviderSessionError("not_started", "opencode session is not started");
    return id;
  }

  /**
   * Register the session's MCP servers with opencode for its directory (`POST /mcp`, which
   * replaces a server of the same name, so a resume brings the fresh token). A server that
   * fails to connect is reported in the transcript; the session still starts.
   */
  private async registerMcp(client: OpencodeClient): Promise<void> {
    for (const m of this.mcp) {
      try {
        const status = await client.addMcp(this.opts.cwd, m.name, m.config);
        const own = status?.[m.name];
        if (own && own.status !== "connected") {
          const detail = own.error ? `: ${own.error}` : "";
          this.pendingNotice = `MCP server ${m.server} did not connect in opencode (${own.status}${detail}).`;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pendingNotice = `MCP server ${m.server} could not be added to opencode: ${message}`;
      }
    }
    this.setUpWith = client;
  }

  private rules() {
    return opencodePermissions(
      { readOnly: this.opts.readOnly },
      this.mcp.map((m) => ({ name: m.name, trusted: m.trusted })),
    );
  }

  private async openOpencodeSession(client: OpencodeClient) {
    const resume = this.opts.resumeToken;
    if (resume) {
      try {
        await client.getSession(this.opts.cwd, resume);
        // Rules from an older CodeBench (or another role) are replaced by today's.
        return await client.updateSession(this.opts.cwd, resume, { permission: this.rules() });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.pendingNotice = `Could not resume opencode session ${resume}; started a new one. ${message}`;
      }
    }
    return client.createSession(this.opts.cwd, {
      title: `CodeBench ${this.opts.role} ${this.opts.sessionId}`.slice(0, 120),
      permission: this.rules(),
    });
  }

  private pendingNotice: string | undefined;
  private streamDown = true;

  /**
   * Keep an event stream open for the session's directory, reconnecting after drops until the
   * session closes. Resolves once the server confirmed the subscription (`server.connected`).
   */
  private openStream(): Promise<void> {
    this.streamDown = false;
    return new Promise<void>((resolve, reject) => {
      let first = true;
      this.onConnected = () => {
        if (first) {
          first = false;
          resolve();
        }
      };
      const loop = async () => {
        while (!this.closed) {
          try {
            const client = await this.config.server.client();
            await client.events(this.opts.cwd, (e) => this.onEvent(e), this.stream.signal);
          } catch (error) {
            if (first) {
              first = false;
              this.streamDown = true;
              reject(error);
              return;
            }
          }
          if (this.closed) return;
          if (!this.config.server.running) {
            // The server is gone: the next `send()` starts it and reopens the stream.
            this.streamDown = true;
            return;
          }
          await new Promise((r) => setTimeout(r, this.config.reconnectDelayMs ?? 1000));
        }
      };
      void loop();
    });
  }

  private onEvent(event: OcEvent): void {
    if (event.type === ("server.connected" as string)) {
      this.onConnected?.();
      return;
    }
    const sid = eventSessionId(event);
    if (!sid || sid !== this.mapper.opencodeSessionId) return;
    if (event.type === "permission.asked") {
      void this.onPermission(event.properties);
      return;
    }
    if (event.type === "question.asked") {
      void this.onQuestion(event.properties);
      return;
    }
    if (this.pendingNotice && this.mapper.currentTurnId && event.type === "session.status") {
      const message = this.pendingNotice;
      this.pendingNotice = undefined;
      this.events.push({
        type: "item.completed",
        threadId: this.mapper.rootThreadId,
        turnId: this.mapper.currentTurnId,
        item: {
          id: `resume-${this.mapper.currentTurnId}`,
          kind: "notice",
          status: "completed",
          level: "warning",
          code: "resume_failed",
          message,
        },
      });
    }
    this.mapper.handle(event);
  }

  private async onPermission(req: OcPermissionRequest): Promise<void> {
    const turnId = this.mapper.currentTurnId;
    const client = await this.config.server.client().catch(() => undefined);
    if (!client) return;
    if (!turnId) {
      await client.replyPermission(this.opts.cwd, req.id, "reject").catch(() => undefined);
      return;
    }
    const ctx = { threadId: this.mapper.rootThreadId, turnId };
    const item = approvalItem(req, this.mapper.itemForCall(req.tool?.callID));
    const decision: PermissionDecision = decidePermission(req, {
      autonomy: this.autonomy,
      readOnly: this.opts.readOnly,
      risk: {
        cwd: this.opts.cwd,
        extraRoots: this.opts.additionalDirectories,
        ...(this.opts.ownBranch ? { ownBranch: this.opts.ownBranch } : {}),
      },
    });
    if (decision.kind !== "ask") {
      // Decided by CodeBench's policy: shown in the transcript, never waited on.
      const allow = decision.kind === "allow";
      this.broker.record(ctx, {
        ...item,
        status: allow ? "completed" : "declined",
        reason: decision.reason,
        decision: allow ? "allow_once" : "deny",
        decidedBy: "policy",
      });
      await client
        .replyPermission(
          this.opts.cwd,
          req.id,
          allow ? "once" : "reject",
          allow ? undefined : decision.reason,
        )
        .catch(() => undefined);
      return;
    }
    const risk = decision.risk;
    const asked = risk.risky
      ? {
          ...item,
          action: item.action === "network" ? item.action : risk.action,
          reason: item.reason ?? risk.reason,
        }
      : item;
    const response = await this.broker.request(ctx, asked);
    const reply =
      response.kind === "approval"
        ? response.decision === "allow_once"
          ? "once"
          : response.decision === "allow_session"
            ? "always"
            : "reject"
        : "reject";
    const message = response.kind === "approval" ? response.message : undefined;
    await client.replyPermission(this.opts.cwd, req.id, reply, message).catch(() => undefined);
  }

  private async onQuestion(req: OcQuestionRequest): Promise<void> {
    const turnId = this.mapper.currentTurnId;
    const client = await this.config.server.client().catch(() => undefined);
    if (!client) return;
    if (!turnId) {
      await client.rejectQuestion(this.opts.cwd, req.id).catch(() => undefined);
      return;
    }
    const item = questionItem(req);
    const response = await this.broker.request(
      { threadId: this.mapper.rootThreadId, turnId },
      item,
    );
    if (response.kind === "answer") {
      const answers = item.questions.map((q) => response.answers[q.id] ?? []);
      await client.replyQuestion(this.opts.cwd, req.id, answers).catch(() => undefined);
    } else {
      await client.rejectQuestion(this.opts.cwd, req.id).catch(() => undefined);
    }
  }

  private onServerExit(code: number | null, stderr: string): void {
    if (this.closed) return;
    this.broker.cancelAll();
    this.streamDown = true;
    this.mapper.endTurn({
      type: "failed",
      code: "provider_exited",
      // The next message starts the server again and resumes the session.
      kind: "transient",
      message: `opencode serve exited (code ${code ?? "unknown"})`,
      ...(stderr ? { detail: stderr.slice(-2000) } : {}),
    });
  }
}
