import type {
  CanUseTool,
  HookCallback,
  PermissionResult,
  Query,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  AgentEvent,
  ItemOf,
  RuntimeResponse,
  SessionOptions,
  UserInput,
  UserQuestion,
} from "@codeden/contracts";
import { type ProviderSession, ProviderSessionError, type SessionConfigChange } from "../adapter";
import { ApprovalBroker } from "../approvals";
import { AsyncQueue } from "../async-queue";
import type { ResolvedCommand } from "../util/exec";
import { str, toJson } from "../util/text";
import { ClaudeEventMapper } from "./mapper";
import { buildQueryOptions, claudeEffort, toSdkUserMessage } from "./options";
import { ClaudePolicy } from "./permissions";
import type { ClaudeSdkModule } from "./sdk";
import { approvalTitle, QUESTION_TOOL } from "./tools";

export interface ClaudeSessionConfig {
  executable: ResolvedCommand;
  /** Called with the CLI's model list once a session is initialized. */
  onModels?: (models: Awaited<ReturnType<Query["supportedModels"]>>) => void;
  /** The SDK's `query()`, loaded by the adapter (installed on demand in the published build). */
  query: ClaudeSdkModule["query"];
  /** How long to wait for the CLI to confirm an interrupt before forcing the turn closed. */
  interruptTimeoutMs?: number;
}

/**
 * A Claude Code session over the Agent SDK with streaming input (§7.2). One `query()` per
 * session; turns are user messages pushed into its prompt queue. If the CLI exits, the next
 * `send()` starts a new query that resumes the same Claude session.
 */
export class ClaudeSession implements ProviderSession {
  readonly events = new AsyncQueue<AgentEvent>();
  private readonly mapper: ClaudeEventMapper;
  private readonly broker: ApprovalBroker;
  private readonly policy: ClaudePolicy;
  private q: Query | undefined;
  private prompts: AsyncQueue<SDKUserMessage> | undefined;
  private abort: AbortController | undefined;
  private stderrTail = "";
  private closed = false;

  constructor(
    private readonly opts: SessionOptions,
    private readonly config: ClaudeSessionConfig,
  ) {
    const emit = (event: AgentEvent) => this.events.push(event);
    this.mapper = new ClaudeEventMapper({ sessionId: opts.sessionId, cwd: opts.cwd, emit });
    this.broker = new ApprovalBroker(emit);
    this.policy = new ClaudePolicy(
      opts.autonomy,
      { cwd: opts.cwd, extraRoots: opts.additionalDirectories },
      opts.readOnly,
    );
    this.mapper.start(opts.resumeToken);
    this.ensureQuery();
  }

  resumeToken(): string | undefined {
    return this.mapper.resumeToken ?? this.opts.resumeToken;
  }

  /** Model/effort for the following turns, applied live through the SDK's streaming query. */
  async configure(change: SessionConfigChange): Promise<void> {
    const q = this.q;
    if (!q) return;
    if (change.model !== undefined) await q.setModel(change.model ?? undefined);
    if (change.effort !== undefined) {
      await q.applyFlagSettings({ effortLevel: claudeEffort(change.effort ?? undefined) ?? null });
    }
  }

  async send(input: UserInput): Promise<void> {
    if (this.closed) throw new ProviderSessionError("closed", "Session is closed");
    if (this.mapper.turnId)
      throw new ProviderSessionError("turn_running", "A turn is already running");
    const message = toSdkUserMessage(input);
    const prompts = this.ensureQuery();
    const turnId = this.mapper.beginTurn();
    this.emitUserMessage(turnId, input);
    prompts.push(message);
  }

  /** Queue input into the running turn; the CLI folds it in at the next tool boundary. */
  async steer(input: UserInput): Promise<void> {
    const turnId = this.mapper.turnId;
    if (!turnId || !this.prompts) throw new ProviderSessionError("no_turn", "No turn is running");
    const message = toSdkUserMessage(input);
    this.emitUserMessage(turnId, input);
    this.prompts.push(message);
  }

  async interrupt(): Promise<void> {
    if (!this.mapper.turnId) return;
    this.mapper.requestInterrupt();
    this.broker.cancelAll();
    const turnId = this.mapper.turnId;
    try {
      await this.q?.interrupt();
    } catch {
      // The CLI may already be gone; the timeout below closes the turn.
    }
    setTimeout(() => {
      if (this.mapper.turnId === turnId)
        this.mapper.endTurn({ type: "interrupted", reason: "user" });
    }, this.config.interruptTimeoutMs ?? 10_000).unref();
  }

  async respond(requestId: string, response: RuntimeResponse): Promise<void> {
    this.broker.respond(requestId, response);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.broker.cancelAll();
    this.mapper.closeAll();
    this.prompts?.close();
    try {
      this.q?.close();
    } catch {
      this.abort?.abort();
    }
    this.events.close();
  }

  // ---------------------------------------------------------------- internals

  private emitUserMessage(turnId: string, input: UserInput): void {
    this.mapper.item({ threadId: this.mapper.rootThreadId, turnId }, "item.completed", {
      id: `user-${turnId}-${Date.now().toString(36)}`,
      kind: "user_message",
      status: "completed",
      input,
    });
  }

  private ensureQuery(): AsyncQueue<SDKUserMessage> {
    if (this.q && this.prompts) return this.prompts;
    const prompts = new AsyncQueue<SDKUserMessage>();
    const abort = new AbortController();
    const preToolUse: HookCallback = async (hookInput) => {
      const name = str(hookInput, "tool_name") ?? "";
      const toolInput = ((hookInput as { tool_input?: unknown }).tool_input ?? {}) as Record<
        string,
        unknown
      >;
      const denied = this.policy.denial(name, toolInput);
      if (denied) {
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
            permissionDecisionReason: denied,
          },
        };
      }
      const gate = this.policy.gate(name, toolInput);
      if (!gate.ask) return {};
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "ask",
          permissionDecisionReason: gate.reason,
        },
      };
    };
    const q = this.config.query({
      prompt: prompts,
      options: buildQueryOptions({
        session: this.opts,
        executable: this.config.executable,
        canUseTool: this.canUseTool,
        hooks: { PreToolUse: [{ hooks: [preToolUse] }] },
        abortController: abort,
        resume: this.resumeToken(),
        stderr: (data) => {
          this.stderrTail = (this.stderrTail + data).slice(-4000);
        },
      }),
    });
    this.q = q;
    this.prompts = prompts;
    this.abort = abort;
    void this.pump(q);
    if (this.config.onModels) {
      q.supportedModels().then(this.config.onModels, () => {});
    }
    return prompts;
  }

  private async pump(q: Query): Promise<void> {
    let failure: unknown;
    try {
      for await (const message of q) this.mapper.handle(message);
    } catch (error) {
      failure = error;
    }
    if (this.q === q) {
      this.q = undefined;
      this.prompts = undefined;
    }
    if (this.closed) return;
    this.broker.cancelAll();
    if (this.mapper.turnId) {
      const message =
        failure instanceof Error ? failure.message : "Claude Code exited unexpectedly";
      this.mapper.endTurn({
        type: "failed",
        error: {
          code: "provider_exited",
          message,
          retryable: true,
          ...(this.stderrTail ? { detail: this.stderrTail } : {}),
        },
      });
    }
  }

  private readonly canUseTool: CanUseTool = async (toolName, input, options) => {
    if (toolName === QUESTION_TOOL)
      return this.askQuestion(input, options.toolUseID, options.signal);
    const denied = this.policy.denial(toolName, input);
    if (denied) return { behavior: "deny", message: denied };
    const gate = this.policy.needsUser(toolName, input);
    if (!gate.ask) return { behavior: "allow", updatedInput: input };
    const ctx = this.mapper.ctxForTool(options.toolUseID);
    const item: ItemOf<"approval_request"> = {
      id: `approval-${options.requestId ?? options.toolUseID}`,
      kind: "approval_request",
      status: "in_progress",
      requestId: options.requestId ?? options.toolUseID,
      action: gate.action,
      title: approvalTitle(toolName, input),
      reason:
        options.decisionReason && options.decisionReason !== gate.reason
          ? `${gate.reason}. ${options.decisionReason}`
          : gate.reason,
      toolName,
      toolInput: toJson(input),
      toolCallItemId: options.toolUseID,
      options: ["allow_once", "allow_session", "deny"],
      ...(str(input, "command") ? { command: str(input, "command"), cwd: this.opts.cwd } : {}),
      ...(str(input, "file_path") ? { paths: [str(input, "file_path") as string] } : {}),
    };
    const response = await this.broker.request(ctx, item, options.signal);
    return this.toPermissionResult(toolName, input, response);
  };

  private toPermissionResult(
    toolName: string,
    input: Record<string, unknown>,
    response: RuntimeResponse,
  ): PermissionResult {
    if (response.kind === "approval" && response.decision !== "deny") {
      if (response.decision === "allow_session") this.policy.allowForSession(toolName, input);
      return { behavior: "allow", updatedInput: input };
    }
    if (response.kind === "approval") {
      return { behavior: "deny", message: response.message ?? "The user denied this action." };
    }
    return { behavior: "deny", message: "The request was cancelled.", interrupt: true };
  }

  private async askQuestion(
    input: Record<string, unknown>,
    toolUseId: string,
    signal: AbortSignal,
  ): Promise<PermissionResult> {
    const raw = Array.isArray(input.questions)
      ? (input.questions as Record<string, unknown>[])
      : [];
    const questions: UserQuestion[] = raw.map((q, i) => ({
      id: `q${i + 1}`,
      header: str(q, "header"),
      question: str(q, "question") ?? "",
      options: (Array.isArray(q.options) ? (q.options as Record<string, unknown>[]) : []).map(
        (o) => ({
          label: str(o, "label") ?? "",
          ...(str(o, "description") ? { description: str(o, "description") } : {}),
        }),
      ),
      multiSelect: q.multiSelect === true,
      allowFreeText: true,
    }));
    if (questions.length === 0) return { behavior: "allow", updatedInput: input };
    const ctx = this.mapper.ctxForTool(toolUseId);
    const response = await this.broker.request(
      ctx,
      {
        id: `question-${toolUseId}`,
        kind: "user_question",
        status: "in_progress",
        requestId: toolUseId,
        questions,
      },
      signal,
    );
    if (response.kind !== "answer") {
      return { behavior: "deny", message: "The user dismissed the question." };
    }
    const answers: Record<string, string> = {};
    for (const q of questions) {
      const picked = response.answers[q.id];
      if (picked?.length) answers[q.question] = picked.join(", ");
    }
    return { behavior: "allow", updatedInput: { ...input, answers } };
  }
}
