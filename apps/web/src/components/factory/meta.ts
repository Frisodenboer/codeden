import type {
  AutonomyMode,
  FactoryItemSource,
  FactoryItemStage,
  FactoryLoopState,
  MergeCheckName,
} from "@codeden/contracts";
import type { Tone } from "@/lib/format";

/** The autonomy ladder (§10.1), climbed one step at a time. */
export const MODES: {
  id: AutonomyMode;
  label: string;
  summary: string;
  finds: string;
  merges: string;
  experimental: boolean;
}[] = [
  {
    id: "manual",
    label: "Manual",
    summary: "You drive every session. Automations only run when you start them.",
    finds: "You",
    merges: "You",
    experimental: false,
  },
  {
    id: "assisted",
    label: "Assisted",
    summary: "You, the PM and automations find work; you review and merge every PR.",
    finds: "You, the PM, automations",
    merges: "You",
    experimental: false,
  },
  {
    id: "autopilot",
    label: "Autopilot",
    summary:
      "The factory loop takes in new issues and builds them; CodeDen merges a PR only when every merge check passes.",
    finds: "Issues and failed checks",
    merges: "CodeDen, after all checks",
    experimental: true,
  },
  {
    id: "dark_factory",
    label: "Dark factory",
    summary:
      "Like autopilot, and improvement finders also look for work continuously, scored against the vision.",
    finds: "Issues, checks and finders",
    merges: "CodeDen, after all checks",
    experimental: true,
  },
];

export const MODE_LABEL: Record<AutonomyMode, string> = {
  manual: "Manual",
  assisted: "Assisted",
  autopilot: "Autopilot",
  dark_factory: "Dark factory",
};

export const LOOP_LABEL: Record<FactoryLoopState, { label: string; tone: Tone }> = {
  idle: { label: "Idle", tone: "idle" },
  discovering: { label: "Discovering", tone: "running" },
  building: { label: "Building", tone: "running" },
  verifying: { label: "Verifying", tone: "waiting" },
  paused: { label: "Paused", tone: "waiting" },
  stopped: { label: "Stopped", tone: "failed" },
};

export const STAGE_LABEL: Record<FactoryItemStage, { label: string; tone: Tone }> = {
  candidate: { label: "Candidate", tone: "idle" },
  backlog: { label: "Backlog", tone: "idle" },
  building: { label: "Building", tone: "running" },
  verifying: { label: "Verifying", tone: "waiting" },
  watching: { label: "Watching main", tone: "running" },
  merged: { label: "Merged", tone: "done" },
  reverted: { label: "Reverted", tone: "failed" },
  rejected: { label: "Rejected", tone: "idle" },
  failed: { label: "Failed", tone: "failed" },
  escalated: { label: "Needs you", tone: "waiting" },
};

export const SOURCE_LABEL: Record<FactoryItemSource, string> = {
  discovery: "Improvement finder",
  issue: "GitHub issue",
  failed_check: "Failed check on main",
  revert: "Revert",
};

export const CHECK_LABEL: Record<MergeCheckName, string> = {
  ci: "CI",
  tests: "Tests",
  review: "Review",
  security: "Security",
  ui_evidence: "UI evidence",
  size: "Size",
  protected_paths: "Protected areas",
};

export const CHECK_HELP: Record<MergeCheckName, string> = {
  ci: "The PR's checks passed on GitHub.",
  tests: "Tests changed with the code, or the change needs none.",
  review: "An independent reviewer session approved it.",
  security: "The audit command and the reviewer found no concerns.",
  ui_evidence: "UI changes have screenshots attached.",
  size: "Small enough to merge without a human.",
  protected_paths: "Touches no protected area from the vision or the limits.",
};
