import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { ApprovalAction, AutonomyLevel } from "@codeden/contracts";
import { readOnlyCommandDenial } from "../policy/read-only";
import type { RiskContext } from "../policy/risk";
import { str } from "../util/text";
import {
  assessClaudeTool,
  COMMAND_TOOLS,
  defaultApprovalAction,
  EDIT_TOOLS,
  PLAN_TOOL,
  QUESTION_TOOL,
} from "./tools";

/** The decision for one tool call. */
export type Gate = { ask: false } | { ask: true; action: ApprovalAction; reason: string };

/**
 * Native permission mode per autonomy level (§11.2):
 * - supervised -> `default`, and every edit/command is forced to ask via a PreToolUse hook
 * - auto       -> `acceptEdits`, plus the risky-action classifier
 * - full       -> `bypassPermissions`, asking only for writes outside the worktree and the
 *                 OS temp directory, and for secrets
 * Plan mode overrides all of them with `plan`.
 */
export function permissionModeFor(autonomy: AutonomyLevel, planMode: boolean): PermissionMode {
  if (planMode) return "plan";
  if (autonomy === "supervised") return "default";
  if (autonomy === "auto") return "acceptEdits";
  return "bypassPermissions";
}

/** Risky actions Full autonomy still asks about (§11.2). */
const FULL_ASKS = new Set<ApprovalAction>(["outside_worktree", "secrets"]);

/**
 * CodeDen's approval policy for Claude tool calls. `gate()` runs in a PreToolUse hook (so it
 * sees every call, including ones Claude would auto-allow) and again in `canUseTool`.
 * Hook `ask` decisions route the call to `canUseTool` in every permission mode.
 */
export class ClaudePolicy {
  private readonly sessionAllow = new Set<string>();

  constructor(
    private autonomy: AutonomyLevel,
    private readonly ctx: RiskContext,
    /** Read-only sessions (orchestrator, PMs): edits and writing commands are denied. */
    private readonly readOnly = false,
  ) {}

  get level(): AutonomyLevel {
    return this.autonomy;
  }

  /** Switch the level; the next `gate()` uses it. `allow_session` decisions are kept. */
  setAutonomy(level: AutonomyLevel): void {
    this.autonomy = level;
  }

  /** Why a call is refused outright (read-only sessions), or undefined. */
  denial(toolName: string, input: Record<string, unknown>): string | undefined {
    if (!this.readOnly) return undefined;
    if (EDIT_TOOLS.has(toolName)) {
      return "This session is read-only: it cannot edit files. Act through CodeDen tools instead.";
    }
    if (COMMAND_TOOLS.has(toolName)) {
      const reason = readOnlyCommandDenial(str(input, "command") ?? "");
      return reason ? `This session is read-only: ${reason}.` : undefined;
    }
    return undefined;
  }

  /**
   * Decide one tool call. `dir` is the shell's current directory as Claude reports it (an
   * earlier `cd` persists between Bash calls); relative paths resolve from it.
   */
  gate(toolName: string, input: Record<string, unknown>, dir?: string): Gate {
    if (toolName === QUESTION_TOOL) {
      return { ask: true, action: "other", reason: "The agent is asking a question" };
    }
    if (toolName === PLAN_TOOL) {
      return { ask: true, action: "other", reason: "The agent finished planning" };
    }
    if (this.sessionAllow.has(this.key(toolName, input))) return { ask: false };
    const risk = assessClaudeTool(toolName, input, dir ? { ...this.ctx, dir } : this.ctx);
    if (this.autonomy === "supervised") {
      if (risk.risky) return { ask: true, action: risk.action, reason: risk.reason };
      if (COMMAND_TOOLS.has(toolName) || EDIT_TOOLS.has(toolName)) {
        return {
          ask: true,
          action: defaultApprovalAction(toolName),
          reason: "Supervised mode: every edit and command needs approval",
        };
      }
      return { ask: false };
    }
    if (!risk.risky) return { ask: false };
    if (this.autonomy === "full" && !FULL_ASKS.has(risk.action)) return { ask: false };
    return { ask: true, action: risk.action, reason: risk.reason };
  }

  /**
   * Whether a `canUseTool` call (Claude's own permission prompt) needs the user. In supervised
   * mode everything Claude asks about goes to the user; otherwise only gated calls do.
   */
  needsUser(toolName: string, input: Record<string, unknown>, dir?: string): Gate {
    const gate = this.gate(toolName, input, dir);
    if (gate.ask || this.autonomy !== "supervised") return gate;
    if (this.sessionAllow.has(this.key(toolName, input))) return gate;
    return {
      ask: true,
      action: defaultApprovalAction(toolName),
      reason: "Claude asked for permission",
    };
  }

  /** Remember an `allow_session` decision. Commands and edits match exactly; others by name. */
  allowForSession(toolName: string, input: Record<string, unknown>): void {
    this.sessionAllow.add(this.key(toolName, input));
  }

  private key(toolName: string, input: Record<string, unknown>): string {
    if (COMMAND_TOOLS.has(toolName)) return `${toolName}:${str(input, "command") ?? ""}`;
    if (EDIT_TOOLS.has(toolName)) {
      return `edit:${str(input, "file_path") ?? str(input, "notebook_path") ?? ""}`;
    }
    return toolName;
  }
}
