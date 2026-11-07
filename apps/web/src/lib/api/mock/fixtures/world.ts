import {
  type Automation,
  type AutomationAction,
  type AutomationTrigger,
  defaultSettings,
  FactoryLimits,
  type Project,
  type ProviderInfo,
  type RunnerConnectionStatus,
  type ScheduledRun,
} from "@codeden/contracts";
import { ago, ahead } from "./helpers";

const limits = FactoryLimits.parse({});

function project(
  p: Pick<Project, "id" | "name" | "slug" | "path"> & Partial<Project>,
  repo?: string,
): Project {
  const base = {
    defaultBranch: "main",
    defaultProvider: null,
    autonomy: null,
    autonomyMode: "assisted" as const,
    visionPath: ".codeden/VISION.md",
    factoryLimits: limits,
    killSwitch: false,
    timezone: null,
    createdAt: ago(60 * 24 * 12),
    updatedAt: ago(30),
    archivedAt: null,
    ...p,
  };
  if (!repo) return { ...base, kind: "local" };
  const [owner = "", name = ""] = repo.split("/");
  return {
    ...base,
    kind: "github",
    github: {
      owner,
      repo: name,
      remoteUrl: `https://github.com/${repo}.git`,
      defaultBranch: "main",
    },
  };
}

export const projects: Project[] = [
  project(
    {
      id: "p-storefront",
      name: "Storefront",
      slug: "storefront",
      path: "C:\\Code\\storefront",
      autonomyMode: "autopilot",
      factoryLimits: {
        ...limits,
        maxConcurrentSessions: 3,
        maxMergesPerDay: 6,
        dailyBudget: { usd: 25 },
        protectedPaths: ["src/payments/**", "migrations/**", "infra/**"],
      },
    },
    "hearth-co/storefront",
  ),
  project(
    { id: "p-billing", name: "Billing API", slug: "billing-api", path: "C:\\Code\\billing-api" },
    "hearth-co/billing-api",
  ),
  project({
    id: "p-notes",
    name: "notes-cli",
    slug: "notes-cli",
    path: "C:\\Code\\notes-cli",
    autonomyMode: "manual",
  }),
];

function automation(
  id: string,
  projectId: string,
  name: string,
  description: string,
  trigger: AutomationTrigger,
  enabled: boolean,
  action: AutomationAction = { type: "start_session", prompt: `Run the ${name} template.` },
): Automation {
  return {
    id,
    name,
    description,
    enabled,
    source: "builtin",
    templateId: id.replace(/^a-\w+-/, ""),
    trigger,
    action,
    target: { type: "project", projectId },
    guards: {
      overlapPolicy: "skip-if-running",
      maxConcurrent: 1,
      maxPerDay: null,
      quietHours: null,
      catchUpMissed: false,
    },
    createdAt: ago(60 * 24 * 10),
    updatedAt: ago(60 * 24),
  };
}

const cron = (expression: string): AutomationTrigger => ({ type: "cron", expression });
const on = (event: Extract<AutomationTrigger, { type: "event" }>["event"]): AutomationTrigger => ({
  type: "event",
  event,
});

export const automations: Automation[] = [
  automation(
    "a-sf-security-audit",
    "p-storefront",
    "Security audit",
    "OWASP-focused review of new code",
    cron("0 9 * * 1"),
    true,
  ),
  automation(
    "a-sf-dependency-updates",
    "p-storefront",
    "Dependency updates",
    "Patch and minor bumps with tests",
    cron("0 6 * * *"),
    true,
  ),
  automation(
    "a-sf-ui-review",
    "p-storefront",
    "UI review",
    "Screenshots and accessibility pass on UI PRs",
    on("pr.opened"),
    true,
  ),
  automation(
    "a-sf-issue-triage",
    "p-storefront",
    "Issue triage",
    "Classify and label new issues",
    on("issue.opened"),
    true,
    { type: "triage" },
  ),
  automation(
    "a-sf-test-coverage",
    "p-storefront",
    "Test coverage gaps",
    "Find untested paths and add tests",
    cron("0 14 * * 3"),
    false,
  ),
  automation(
    "a-sf-refactor-sweep",
    "p-storefront",
    "Refactor sweep",
    "Small, safe cleanups in hot files",
    cron("0 3 * * 6"),
    false,
  ),
  automation(
    "a-sf-stale-prs",
    "p-storefront",
    "Stale PR follow-up",
    "Nudge or close PRs idle for 7 days",
    cron("0 10 * * *"),
    false,
  ),
  automation(
    "a-bl-security-audit",
    "p-billing",
    "Security audit",
    "OWASP-focused review of new code",
    cron("0 9 * * 1"),
    true,
  ),
  automation(
    "a-bl-issue-triage",
    "p-billing",
    "Issue triage",
    "Classify and label new issues",
    on("issue.opened"),
    false,
    { type: "triage" },
  ),
  automation(
    "a-nt-dependency-updates",
    "p-notes",
    "Dependency updates",
    "Patch and minor bumps with tests",
    cron("0 6 * * 1"),
    false,
  ),
];

export const scheduled: ScheduledRun[] = [
  {
    automationId: "a-sf-dependency-updates",
    projectId: "p-storefront",
    name: "Dependency updates",
    workKey: "automation:dependency-updates",
    at: ahead(38),
    skipped: false,
  },
  {
    automationId: "a-sf-stale-prs",
    projectId: "p-storefront",
    name: "Stale PR follow-up",
    workKey: "automation:stale-prs",
    at: ahead(150),
    skipped: true,
  },
  {
    automationId: "a-sf-security-audit",
    projectId: "p-storefront",
    name: "Security audit",
    workKey: "automation:security-audit",
    at: ahead(60 * 19),
    skipped: false,
  },
  {
    automationId: "a-bl-security-audit",
    projectId: "p-billing",
    name: "Security audit",
    workKey: "automation:security-audit",
    at: ahead(60 * 19 + 5),
    skipped: false,
  },
];

const caps = {
  resume: true,
  steer: true,
  interrupt: true,
  approvals: true,
  userQuestions: true,
  subagents: true,
  rollback: false,
  fork: true,
  images: true,
  planMode: true,
  reasoningEffort: true,
  mcp: true,
  skills: true,
};

export const providers: ProviderInfo[] = [
  {
    id: "claude",
    displayName: "Claude Code",
    capabilities: caps,
    models: [
      {
        id: "opus",
        label: "Opus",
        description: "Most capable for complex work",
        efforts: ["low", "medium", "high", "xhigh", "max"],
        defaultEffort: "high",
        isDefault: true,
        contextWindow: 200_000,
      },
      {
        id: "sonnet",
        label: "Sonnet",
        description: "Fast and capable for everyday tasks",
        efforts: ["low", "medium", "high"],
        defaultEffort: "medium",
        contextWindow: 200_000,
      },
      {
        id: "haiku",
        label: "Haiku",
        description: "Fastest, for quick answers",
        efforts: [],
        contextWindow: 200_000,
      },
    ],
  },
  {
    id: "codex",
    displayName: "Codex",
    capabilities: { ...caps, subagents: false, userQuestions: false, skills: true },
    models: [
      {
        id: "gpt-codex",
        label: "GPT Codex",
        description: "Tuned for agentic coding",
        efforts: ["minimal", "low", "medium", "high", "xhigh"],
        defaultEffort: "medium",
        isDefault: true,
        contextWindow: 272_000,
      },
      {
        id: "gpt-codex-mini",
        label: "GPT Codex Mini",
        description: "Cheaper and faster",
        efforts: ["low", "medium", "high"],
        defaultEffort: "medium",
        contextWindow: 272_000,
      },
    ],
  },
];

export const runner: RunnerConnectionStatus = {
  state: "connected",
  runnerId: "runner-local",
  version: "0.1.0",
  providers,
  lastError: null,
};

export const settings = (() => {
  const s = defaultSettings();
  s.voice.readAloud.enabled = true;
  s.voice.readAloud.onlyWhenUnfocused = true;
  s.notifications.browser = true;
  return s;
})();
