/**
 * Types the web client needs that are not in `@codeden/contracts`: UI-only shapes (file tree
 * nodes, live channels) and data for screens whose server APIs are not wired yet (factory,
 * conflicts list, PR details). Server shapes come from contracts.
 */
import type {
  AutonomyMode,
  FactoryLimits,
  FactoryLoopState,
  GitHubIssueRef,
  GitHubPrRef,
  ProviderId,
  StartSessionRequestInit,
  WorkKey,
  WorkSummary,
} from "@codeden/contracts";

// ------------------------------------------------------------------ factory panel (§10.1)

export interface FactoryWorkItem {
  id: string;
  title: string;
  workKey: WorkKey;
  issue: GitHubIssueRef | null;
  pr: GitHubPrRef | null;
  score?: number;
  sessionId?: string | null;
  stage: "backlog" | "building" | "verifying" | "merged" | "reverted" | "rejected";
}

export type MergeCheckName = "ci" | "tests" | "review" | "security" | "ui_evidence" | "size";
export interface MergeCheckResult {
  prNumber: number;
  title: string;
  checks: {
    name: MergeCheckName;
    state: "pending" | "pass" | "fail" | "skipped";
    detail?: string;
  }[];
}

export interface FactoryStatus {
  projectId: string;
  mode: AutonomyMode;
  loopState: FactoryLoopState;
  killSwitch: boolean;
  limits: FactoryLimits;
  spendToday: { tokens: number; usd: number };
  mergesToday: number;
  consecutiveFailures: number;
  backlog: FactoryWorkItem[];
  inProgress: FactoryWorkItem[];
  mergeChecks: MergeCheckResult[];
  recent: FactoryWorkItem[];
  visionExists: boolean;
}

// ------------------------------------------------------------------ conflicts (§8.4)

/** A start request that collided with running work, waiting for a decision. */
export interface ConflictCase {
  id: string;
  projectId: string | null;
  request: { purpose: string; workKey: WorkKey; requestedBy: string };
  existing: WorkSummary[];
  createdAt: string;
  /** The original start request, retried with the decision (real server). */
  start?: StartSessionRequestInit;
}

// ------------------------------------------------------------------ workbench (§12)

/** A node of the files panel tree, built from `SessionFileList` entries. */
export interface FileNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  children?: FileNode[];
  /** Git status in the worktree. */
  status?: "added" | "modified" | "deleted";
}

export interface PrDetails {
  issue: (GitHubIssueRef & { body: string; labels: string[]; state: "open" | "closed" }) | null;
  pr:
    | (GitHubPrRef & {
        body: string;
        checks: { name: string; state: "pending" | "pass" | "fail" }[];
        reviews: { author: string; state: "approved" | "changes_requested" | "commented" }[];
        additions: number;
        deletions: number;
      })
    | null;
}

export interface MentionCandidate {
  path: string;
  kind: "file" | "dir";
}

export interface SlashCommand {
  name: string;
  description: string;
  kind: "command" | "skill";
  /** Provider that owns a skill, if any. */
  provider?: ProviderId;
}

// ------------------------------------------------------------------ live workbench channels

/** Lifecycle of a terminal channel (`/ws/pty` control frames). */
export type TerminalEvent =
  | { type: "opened"; ptyId: string; attached: boolean }
  | { type: "exited"; exitCode: number | null }
  | { type: "error"; message: string };

export interface TerminalChannel {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: string) => void): () => void;
  onEvent(listener: (event: TerminalEvent) => void): () => void;
  /** Detach (the terminal keeps running in the runner). */
  close(): void;
  /** End the terminal process. */
  kill(): void;
}

export interface OpenTerminalOptions {
  sessionId: string | null;
  /** Typed into the shell once it starts (e.g. `claude auth login`). */
  command?: string;
  /** Re-attach to a terminal opened earlier instead of starting a new one. */
  ptyId?: string;
}
