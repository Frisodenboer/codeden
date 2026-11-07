/**
 * Types the web client needs that are not (yet) in `@codeden/contracts`.
 * Each one is a candidate for adoption into the shared contracts (see the M1 UI report).
 */
import type {
  AutonomyMode,
  FactoryLimits,
  FactoryLoopState,
  GitHubIssueRef,
  GitHubPrRef,
  ProviderId,
  WorkKey,
  WorkSummary,
} from "@codeden/contracts";

// ------------------------------------------------------------------ first-run setup (§14)

export type SetupCheckId = "claude" | "codex" | "github" | "git" | "browser";
export type SetupCheckState = "checking" | "ok" | "warning" | "missing";

/** One row of the first-run checklist. */
export interface SetupCheck {
  id: SetupCheckId;
  label: string;
  state: SetupCheckState;
  /** One-line result, e.g. `v2.1.4 · signed in as leon@…`. */
  detail: string | null;
  required: boolean;
  /** The single action that fixes a failed check. */
  fix: { kind: "install" | "login" | "configure"; label: string; command: string } | null;
}

export interface SetupStatus {
  checks: SetupCheck[];
  /** True once at least one agent provider is ready. */
  ready: boolean;
  completed: boolean;
}

// ------------------------------------------------------------------ server-side folder picker

export interface DirEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  isGitRepo?: boolean;
  hidden?: boolean;
}

export interface DirListing {
  path: string;
  parent: string | null;
  entries: DirEntry[];
  /** Quick-jump locations (home, drives, recent). */
  places: { label: string; path: string }[];
}

export type CreateProjectInput =
  | { source: "folder"; path: string; name?: string }
  | { source: "clone"; url: string; directory?: string };

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
}

export interface StartSessionInput {
  projectId: string;
  prompt: string;
  provider?: ProviderId;
  model?: string;
  workKey?: string;
}

// ------------------------------------------------------------------ workbench (§12)

export type DiffScope =
  | { kind: "session" }
  | { kind: "turn"; turnId: string }
  | { kind: "uncommitted" };

export interface DiffFile {
  path: string;
  previousPath?: string;
  change: "add" | "modify" | "delete" | "rename";
  additions: number;
  deletions: number;
  /** Unified patch for this file. */
  patch: string;
}

export interface DiffResult {
  scope: DiffScope;
  files: DiffFile[];
  /** Turns that have checkpoints, newest last. */
  turns: { id: string; index: number; label: string; at: string }[];
}

export interface FileNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  children?: FileNode[];
  /** Git status relative to the base branch. */
  status?: "added" | "modified" | "deleted";
}

export interface FileContent {
  path: string;
  contents: string;
  language?: string;
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

export interface LoadedContext {
  memory: string[];
  skills: string[];
  mcpServers: string[];
}

// ------------------------------------------------------------------ agent configuration (§12.4)

export type ConfigScope = "global" | "project" | "local";

export interface MemoryFile {
  id: string;
  provider: ProviderId;
  scope: ConfigScope;
  label: string;
  path: string;
  exists: boolean;
  sizeBytes: number;
  updatedAt: string | null;
}

export interface SkillEntry {
  id: string;
  name: string;
  description: string;
  provider: ProviderId;
  scope: ConfigScope;
  path: string;
  enabled: boolean;
}

export interface SubagentEntry {
  id: string;
  name: string;
  description: string;
  provider: ProviderId;
  scope: ConfigScope;
  path: string;
  model: string | null;
  tools: string[];
}

export interface McpServerEntry {
  id: string;
  name: string;
  transport: "stdio" | "http";
  target: string;
  source: string;
  enabledFor: ProviderId[];
  status: "connected" | "error" | "unknown";
  toolCount: number | null;
}

// ------------------------------------------------------------------ live workbench channels

export interface TerminalChannel {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (data: string) => void): () => void;
  close(): void;
}

export interface BrowserFrame {
  /** Image URL (data: or blob:) of the latest screencast frame. */
  src: string;
  width: number;
  height: number;
  url: string;
  title: string;
}

export interface BrowserChannel {
  onFrame(listener: (frame: BrowserFrame) => void): () => void;
  navigate(url: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  /** Take over input from the agent (or hand it back). */
  setControl(owner: "agent" | "user"): void;
  click(x: number, y: number): void;
  close(): void;
}
