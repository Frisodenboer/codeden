import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { ApprovalAction, AutonomyLevel } from "@codeden/contracts";
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
 * - full       -> `bypassPermissions`, asking only for writes outside the worktree
 * Plan mode overrides all of them with `plan`.
 */
export function permissionModeFor(autonomy: AutonomyLevel, planMode: boolean): PermissionMode {
  if (planMode) return "plan";
  if (autonomy === "supervised") return "default";
  if (autonomy === "auto") return "acceptEdits";
  return "bypassPermissions";
}

/**
 * CodeDen's approval policy for Claude tool calls. `gate()` runs in a PreToolUse hook (so it
 * sees every call, including ones Claude would auto-allow) and again in `canUseTool`.
 * Hook `ask` decisions route the call to `canUseTool` in every permission mode.
 */
export class ClaudePolicy {
  private readonly sessionAllow = new Set<string>();

  constructor(
    private readonly autonomy: AutonomyLevel,
    private readonly ctx: RiskContext,
  ) {}

  gate(toolName: string, input: Record<string, unknown>): Gate {
    if (toolName === QUESTION_TOOL) {
      return { ask: true, action: "other", reason: "The agent is asking a question" };
    }
    if (toolName === PLAN_TOOL) {
      return { ask: true, action: "other", reason: "The agent finished planning" };
    }
    if (this.sessionAllow.has(this.key(toolName, input))) return { ask: false };
    const risk = assessClaudeTool(toolName, input, this.ctx);
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
    if (this.autonomy === "full" && risk.action !== "outside_worktree") return { ask: false };
    return { ask: true, action: risk.action, reason: risk.reason };
  }

  /**
   * Whether a `canUseTool` call (Claude's own permission prompt) needs the user. In supervised
   * mode everything Claude asks about goes to the user; otherwise only gated calls do.
   */
  needsUser(toolName: string, input: Record<string, unknown>): Gate {
    const gate = this.gate(toolName, input);
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
