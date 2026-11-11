import type { AutonomyLevel, McpServerConfig } from "@codeden/contracts";
import { readOnlyCommandDenial } from "../policy/read-only";
import {
  classifyCommand,
  classifyFetch,
  classifyRead,
  classifyWrite,
  type RiskAssessment,
  type RiskContext,
} from "../policy/risk";
import type { OcPermissionRequest, OcPermissionRule } from "./types";

/**
 * CodeBench's permission levels on opencode (§11.2, docs/plans/opencode-provider.md step 5).
 *
 * opencode is told to *ask* for every edit, command, fetch and access outside the project, and
 * CodeBench answers each request itself, so the level applies from the next tool call (live):
 * - **read_only** (and the read-only roles): edits are refused; commands run only when the
 *   read-only allowlist accepts them (agents may also run checks); reads and fetches are fine.
 * - **supervised**: every request reaches the user.
 * - **auto**: the risk classifier decides; only risky requests reach the user.
 * - **full**: everything runs, except writes outside the worktree.
 * Read-only *roles* (orchestrator, PMs) also get a native `edit: deny`, as a second wall.
 */

/** What CodeBench does with one opencode permission request. */
export type PermissionDecision =
  | { kind: "allow"; reason: string }
  | { kind: "deny"; reason: string }
  | { kind: "ask"; risk: RiskAssessment };

const EDITS = new Set(["edit", "write", "multiedit", "patch", "apply_patch"]);
const READS = new Set(["read", "glob", "grep", "list", "codesearch", "lsp"]);
const FETCHES = new Set(["webfetch", "websearch"]);

/** The name an MCP server is registered under in opencode for one CodeBench session. */
export function opencodeMcpName(server: string, sessionId: string): string {
  const id = sessionId.replace(/[^a-zA-Z0-9]/g, "").slice(-8) || "session";
  return `${server.replace(/[^a-zA-Z0-9_-]/g, "_")}-${id}`;
}

/** The rule set an opencode session starts with (and gets again on resume). */
export function opencodePermissions(
  opts: { readOnly?: boolean | undefined },
  mcp: readonly { name: string; trusted: boolean }[] = [],
): OcPermissionRule[] {
  const rule = (permission: string, action: OcPermissionRule["action"]): OcPermissionRule => ({
    permission,
    pattern: "*",
    action,
  });
  return [
    rule("edit", opts.readOnly ? "deny" : "ask"),
    rule("bash", "ask"),
    rule("webfetch", "ask"),
    rule("websearch", "ask"),
    rule("external_directory", "ask"),
    // CodeBench's own tools run without prompts; other MCP servers ask like any tool.
    ...mcp.map((s) => rule(`${s.name}_*`, s.trusted ? "allow" : "ask")),
  ];
}

/** The paths a request is about: opencode's `metadata.filepath`, else its patterns. */
function paths(req: OcPermissionRequest): string[] {
  const meta = req.metadata ?? {};
  if (typeof meta.filepath === "string") return [meta.filepath];
  if (Array.isArray(meta.files)) {
    const files = meta.files.flatMap((f) =>
      typeof f === "string"
        ? [f]
        : f && typeof f === "object" && typeof (f as { filePath?: unknown }).filePath === "string"
          ? [(f as { filePath: string }).filePath]
          : [],
    );
    if (files.length) return files;
  }
  // `external_directory` patterns are folders with a trailing `/*` or `\*`.
  return req.patterns.map((p) => p.replace(/[\\/]\*+$/, "")).filter(Boolean);
}

function first(items: RiskAssessment[]): RiskAssessment {
  return items.find((r) => r.risky) ?? { risky: false };
}

/** The classifier's view of a request, independent of the level. */
export function permissionRisk(req: OcPermissionRequest, ctx: RiskContext): RiskAssessment {
  const p = req.permission;
  if (p === "bash") {
    const command = commandOf(req);
    return command
      ? classifyCommand(command, ctx)
      : { risky: true, action: "command", reason: "Runs a command opencode did not name" };
  }
  if (EDITS.has(p)) {
    const targets = paths(req);
    return targets.length
      ? first(targets.map((t) => classifyWrite(t, ctx)))
      : { risky: true, action: "outside_worktree", reason: "Changes files opencode did not name" };
  }
  if (READS.has(p)) return first(paths(req).map((t) => classifyRead(t, ctx)));
  if (p === "external_directory") {
    const targets = paths(req);
    return targets.length
      ? first(targets.map((t) => classifyWrite(t, ctx)))
      : { risky: true, action: "outside_worktree", reason: "Works outside the worktree" };
  }
  if (FETCHES.has(p)) {
    const url = typeof req.metadata?.url === "string" ? req.metadata.url : req.patterns[0];
    return url && p === "webfetch" ? classifyFetch(url, ctx) : { risky: false };
  }
  if (p === "doom_loop") {
    return { risky: true, action: "tool", reason: "opencode saw the same tool call repeat" };
  }
  return { risky: true, action: "tool", reason: `Uses ${p}` };
}

/** The command line of a `bash` request. */
export function commandOf(req: OcPermissionRequest): string {
  const meta = req.metadata ?? {};
  if (typeof meta.command === "string") return meta.command;
  return req.patterns.join(" && ");
}

/** True when the permission level allows an action the classifier assessed as `risk`. */
function levelAllows(autonomy: AutonomyLevel, risk: RiskAssessment): boolean {
  if (autonomy === "auto") return !risk.risky;
  if (autonomy === "full") return !risk.risky || risk.action !== "outside_worktree";
  return false;
}

export interface DecideOptions {
  autonomy: AutonomyLevel;
  /** Read-only role (orchestrator, PM): no checks either. */
  readOnly?: boolean | undefined;
  risk: RiskContext;
}

/** Decide one opencode permission request for the session's current level. */
export function decidePermission(
  req: OcPermissionRequest,
  opts: DecideOptions,
): PermissionDecision {
  const readOnly = opts.readOnly || opts.autonomy === "read_only";
  const risk = permissionRisk(req, opts.risk);
  if (readOnly) {
    if (EDITS.has(req.permission)) {
      return { kind: "deny", reason: "File edits are not allowed in a read-only session" };
    }
    if (req.permission === "bash") {
      const denial = readOnlyCommandDenial(commandOf(req), { allowChecks: !opts.readOnly });
      return denial
        ? { kind: "deny", reason: denial }
        : { kind: "allow", reason: "Read-only command" };
    }
    if (req.permission === "external_directory") {
      // Reading elsewhere is fine; anything opencode would write there was refused above.
      const reads = first(paths(req).map((t) => classifyRead(t, opts.risk)));
      return reads.risky
        ? { kind: "ask", risk: reads }
        : { kind: "allow", reason: "Read-only access" };
    }
    if (READS.has(req.permission) || FETCHES.has(req.permission)) {
      return risk.risky ? { kind: "ask", risk } : { kind: "allow", reason: "Read-only access" };
    }
    return { kind: "ask", risk };
  }
  if (levelAllows(opts.autonomy, risk)) {
    return {
      kind: "allow",
      reason: `Allowed by the ${opts.autonomy === "full" ? "Full" : "Auto"} permission level`,
    };
  }
  return { kind: "ask", risk };
}

/** One CodeBench MCP server as opencode's MCP config (`POST /mcp`). */
export function opencodeMcpConfig(server: McpServerConfig): Record<string, unknown> {
  if (server.transport === "http") {
    return {
      type: "remote",
      url: server.url,
      ...(server.headers ? { headers: server.headers } : {}),
      // CodeBench's proxy authenticates with the session's bearer token, never OAuth.
      oauth: false,
      ...(server.toolTimeoutSec ? { timeout: server.toolTimeoutSec * 1000 } : {}),
    };
  }
  return {
    type: "local",
    command: [server.command, ...server.args],
    ...(server.env ? { environment: server.env } : {}),
  };
}
