import { FactoryLimits } from "@codeden/contracts";
import type { DirListing, FactoryStatus, SetupCheck } from "../../types";
import { gh } from "./helpers";

const sf = gh("hearth-co/storefront");

export function factoryFor(
  projectId: string,
  mode: FactoryStatus["mode"],
  limits: FactoryLimits,
): FactoryStatus {
  if (projectId !== "p-storefront") {
    return {
      projectId,
      mode,
      loopState: "idle",
      killSwitch: false,
      limits,
      spendToday: { tokens: 0, usd: 0 },
      mergesToday: 0,
      consecutiveFailures: 0,
      backlog: [],
      inProgress: [],
      mergeChecks: [],
      recent: [],
      visionExists: false,
    };
  }
  return {
    projectId,
    mode,
    loopState: "building",
    killSwitch: false,
    limits,
    spendToday: { tokens: 3_420_000, usd: 14.6 },
    mergesToday: 3,
    consecutiveFailures: 0,
    visionExists: true,
    backlog: [
      {
        id: "fw-1",
        title: "Dark mode for the storefront",
        workKey: "issue:151",
        issue: sf.issue(151, "Dark mode"),
        pr: null,
        score: 0.82,
        stage: "backlog",
      },
      {
        id: "fw-2",
        title: "Lazy-load product images below the fold",
        workKey: "issue:153",
        issue: sf.issue(153, "Lazy-load images"),
        pr: null,
        score: 0.77,
        stage: "backlog",
      },
      {
        id: "fw-3",
        title: "Cover discount-code edge cases with tests",
        workKey: "issue:154",
        issue: sf.issue(154, "Discount tests"),
        pr: null,
        score: 0.64,
        stage: "backlog",
      },
      {
        id: "fw-4",
        title: "Replace moment with date-fns",
        workKey: "issue:149",
        issue: sf.issue(149, "Drop moment"),
        pr: null,
        score: 0.41,
        stage: "backlog",
      },
    ],
    inProgress: [
      {
        id: "fw-5",
        title: "Product search with filters",
        workKey: "issue:139",
        issue: sf.issue(139, "Search"),
        pr: sf.pr(57, "Search", "draft"),
        sessionId: "s-search",
        stage: "building",
      },
      {
        id: "fw-6",
        title: "Fix flaky checkout e2e test",
        workKey: "issue:142",
        issue: sf.issue(142, "Flaky checkout"),
        pr: null,
        sessionId: "s-checkout",
        stage: "building",
      },
      {
        id: "fw-7",
        title: "Accessibility fixes on the product page",
        workKey: "pr:58",
        issue: null,
        pr: sf.pr(58, "A11y fixes", "open"),
        sessionId: "s-a11y",
        stage: "verifying",
      },
    ],
    mergeChecks: [
      {
        prNumber: 58,
        title: "Accessibility fixes on the product page",
        checks: [
          { name: "ci", state: "pass" },
          { name: "tests", state: "pass" },
          { name: "review", state: "pass", detail: "Codex review: approved" },
          { name: "security", state: "pass" },
          { name: "ui_evidence", state: "pass", detail: "2 screenshots" },
          { name: "size", state: "pass", detail: "+18 −9" },
        ],
      },
      {
        prNumber: 57,
        title: "Product search with filters",
        checks: [
          { name: "ci", state: "pending" },
          { name: "tests", state: "pass" },
          { name: "review", state: "pending" },
          { name: "security", state: "pass" },
          { name: "ui_evidence", state: "fail", detail: "No screenshot of the price slider" },
          { name: "size", state: "pass", detail: "+61 −3" },
        ],
      },
    ],
    recent: [
      {
        id: "fw-8",
        title: "Sticky add-to-cart bar on mobile",
        workKey: "issue:144",
        issue: sf.issue(144, "Sticky bar"),
        pr: sf.pr(55, "Sticky bar", "merged"),
        stage: "merged",
      },
      {
        id: "fw-9",
        title: "Cache product JSON at the edge",
        workKey: "issue:146",
        issue: sf.issue(146, "Edge cache"),
        pr: sf.pr(56, "Edge cache", "merged"),
        stage: "reverted",
      },
      {
        id: "fw-10",
        title: "Gift-wrap option at checkout",
        workKey: "idea:gift-wrap",
        issue: null,
        pr: null,
        stage: "rejected",
      },
      {
        id: "fw-11",
        title: "Fix footer link contrast",
        workKey: "issue:147",
        issue: sf.issue(147, "Footer"),
        pr: sf.pr(54, "Footer contrast", "merged"),
        stage: "merged",
      },
    ],
  };
}

export const defaultFactoryLimits = FactoryLimits.parse({});

export const setupChecks: SetupCheck[] = [
  {
    id: "claude",
    label: "Claude Code",
    state: "ok",
    detail: "v2.1.4 · signed in (Max plan)",
    required: false,
    fix: null,
  },
  {
    id: "codex",
    label: "Codex",
    state: "missing",
    detail: "Installed (0.58.0) but not signed in",
    required: false,
    fix: { kind: "login", label: "Sign in", command: "codex login" },
  },
  {
    id: "github",
    label: "GitHub",
    state: "ok",
    detail: "Signed in as leon · repo, workflow scopes",
    required: false,
    fix: null,
  },
  {
    id: "git",
    label: "git identity",
    state: "ok",
    detail: "Leon van Zyl <leon@example.com>",
    required: true,
    fix: null,
  },
  {
    id: "browser",
    label: "Browser for agents",
    state: "ok",
    detail: "Microsoft Edge 142",
    required: false,
    fix: null,
  },
];

type Tree = Record<string, { dirs: string[]; files?: string[]; repos?: string[] }>;

const tree: Tree = {
  "C:\\Users\\leon": { dirs: ["Code", "Documents", "Downloads", ".config"], files: [".gitconfig"] },
  "C:\\Users\\leon\\Code": {
    dirs: ["storefront", "billing-api", "notes-cli", "garden-planner", "dotfiles", "experiments"],
    repos: ["storefront", "billing-api", "notes-cli", "garden-planner", "dotfiles"],
  },
  "C:\\Users\\leon\\Code\\garden-planner": {
    dirs: ["src", "public", "tests"],
    files: ["package.json", "README.md", "vite.config.ts"],
  },
  "C:\\Users\\leon\\Code\\experiments": { dirs: ["wasm-audio", "rust-cli"], repos: ["wasm-audio"] },
  "C:\\Users\\leon\\Documents": { dirs: ["Notes", "Talks"] },
};

export function listDir(path: string | null): DirListing {
  const p = path ?? "C:\\Users\\leon\\Code";
  const node = tree[p] ?? { dirs: [] };
  const parent =
    p.includes("\\") && p.split("\\").length > 2 ? p.slice(0, p.lastIndexOf("\\")) : null;
  return {
    path: p,
    parent,
    entries: [
      ...node.dirs.map((name) => ({
        name,
        path: `${p}\\${name}`,
        kind: "dir" as const,
        isGitRepo: node.repos?.includes(name) ?? false,
        hidden: name.startsWith("."),
      })),
      ...(node.files ?? []).map((name) => ({ name, path: `${p}\\${name}`, kind: "file" as const })),
    ],
    places: [
      { label: "Home", path: "C:\\Users\\leon" },
      { label: "Code", path: "C:\\Users\\leon\\Code" },
      { label: "Documents", path: "C:\\Users\\leon\\Documents" },
    ],
  };
}

export const visionDoc = `# Storefront vision

## Goals
- The calmest, fastest way to buy home goods online.
- Every page loads in under one second on a mid-range phone.

## Target users
Design-minded shoppers on mobile, often browsing in the evening.

## Principles
- Fewer, better features. No dark patterns.
- Accessibility is a feature: WCAG AA everywhere.

## Out of scope
- Marketplace / third-party sellers
- Loyalty points

## Quality bar
Tests for every behaviour change; screenshots for every UI change.

## Protected areas
- \`src/payments/**\`, \`migrations/**\`, \`infra/**\`
- Anything touching licensing or customer data exports
`;
