import type {
  AutonomyMode,
  FactoryLimits,
  FactoryLoopState,
  GitHubIssueRef,
  GitHubPrRef,
  WorkKey,
} from "@codeden/contracts";

/** Compact factory panel fixtures; the mock fills in the full `FactoryStatus` shape. */

export interface FixtureWorkItem {
  id: string;
  title: string;
  workKey: WorkKey;
  issue: GitHubIssueRef | null;
  pr: GitHubPrRef | null;
  score?: number;
  sessionId?: string | null;
  stage: "backlog" | "building" | "verifying" | "merged" | "reverted" | "rejected";
}

export type FixtureCheckName = "ci" | "tests" | "review" | "security" | "ui_evidence" | "size";

export interface FixtureChecks {
  prNumber: number;
  title: string;
  checks: {
    name: FixtureCheckName;
    state: "pending" | "pass" | "fail" | "skipped";
    detail?: string;
  }[];
}

export interface FactoryFixture {
  projectId: string;
  mode: AutonomyMode;
  loopState: FactoryLoopState;
  killSwitch: boolean;
  limits: FactoryLimits;
  spendToday: { tokens: number; usd: number };
  mergesToday: number;
  consecutiveFailures: number;
  backlog: FixtureWorkItem[];
  inProgress: FixtureWorkItem[];
  mergeChecks: FixtureChecks[];
  recent: FixtureWorkItem[];
  visionExists: boolean;
}
