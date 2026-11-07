import type {
  Automation,
  AutomationRun,
  ErrorInfo,
  FactoryLimits,
  GitHubIssueRef,
  GitHubPrRef,
  GitHubRepo,
  Item,
  JsonValue,
  StartedBy,
  WorkProgress,
  WorkScope,
} from "@codeden/contracts";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * SQLite schema (§6). `events` is the append-only audit trail and replay source; every other
 * table is a projection written in the same transaction as the event that produces it.
 * Timestamps are UTC ISO-8601 strings. Change this file, then run `pnpm db:generate`.
 */

const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

export const events = sqliteTable(
  "events",
  {
    seq: integer("seq").primaryKey({ autoIncrement: true }),
    sessionId: text("session_id"),
    type: text("type").notNull(),
    payload: json<unknown>("payload").notNull(),
    ts: text("ts").notNull(),
  },
  (t) => [index("events_session_seq").on(t.sessionId, t.seq), index("events_type").on(t.type)],
);

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["github", "local"] }).notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    path: text("path").notNull(),
    defaultBranch: text("default_branch"),
    defaultProvider: text("default_provider"),
    autonomy: text("autonomy"),
    autonomyMode: text("autonomy_mode").notNull().default("assisted"),
    visionPath: text("vision_path").notNull().default(".codeden/VISION.md"),
    factoryLimits: json<FactoryLimits>("factory_limits"),
    killSwitch: integer("kill_switch", { mode: "boolean" }).notNull().default(false),
    timezone: text("timezone"),
    github: json<GitHubRepo>("github"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    archivedAt: text("archived_at"),
  },
  (t) => [uniqueIndex("projects_slug").on(t.slug)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id"),
    role: text("role").notNull(),
    parentSessionId: text("parent_session_id"),
    startedBy: json<StartedBy>("started_by").notNull(),
    purpose: text("purpose").notNull(),
    workKey: text("work_key").notNull(),
    scope: json<WorkScope>("scope").notNull(),
    progress: json<WorkProgress>("progress"),
    title: text("title"),
    provider: text("provider").notNull(),
    model: text("model"),
    effort: text("effort"),
    autonomy: text("autonomy").notNull(),
    status: text("status").notNull(),
    cwd: text("cwd").notNull(),
    worktreePath: text("worktree_path"),
    branch: text("branch"),
    baseBranch: text("base_branch"),
    issue: json<GitHubIssueRef>("issue"),
    pr: json<GitHubPrRef>("pr"),
    resumeToken: text("resume_token"),
    runnerId: text("runner_id"),
    automationRunId: text("automation_run_id"),
    rootThreadId: text("root_thread_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    endedAt: text("ended_at"),
  },
  (t) => [
    index("sessions_project").on(t.projectId),
    index("sessions_status").on(t.status),
    index("sessions_work_key").on(t.projectId, t.workKey),
  ],
);

// Thread/turn/item ids come from providers and are only unique within a session.
export const threads = sqliteTable(
  "threads",
  {
    sessionId: text("session_id").notNull(),
    id: text("id").notNull(),
    parentThreadId: text("parent_thread_id"),
    parentItemId: text("parent_item_id"),
    title: text("title"),
    agentType: text("agent_type"),
    createdAt: text("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.id] })],
);

export const turns = sqliteTable(
  "turns",
  {
    sessionId: text("session_id").notNull(),
    id: text("id").notNull(),
    threadId: text("thread_id").notNull(),
    status: text("status").notNull(),
    startedAt: text("started_at").notNull(),
    completedAt: text("completed_at"),
    error: json<ErrorInfo>("error"),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.id] })],
);

export const items = sqliteTable(
  "items",
  {
    sessionId: text("session_id").notNull(),
    id: text("id").notNull(),
    threadId: text("thread_id").notNull(),
    turnId: text("turn_id").notNull(),
    position: integer("position").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    data: json<Item>("data").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.id] }),
    index("items_thread").on(t.sessionId, t.threadId, t.position),
  ],
);

export const inboxItems = sqliteTable(
  "inbox_items",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(),
    status: text("status").notNull(),
    priority: text("priority").notNull().default("normal"),
    title: text("title").notNull(),
    body: text("body"),
    projectId: text("project_id"),
    sessionId: text("session_id"),
    threadId: text("thread_id"),
    itemId: text("item_id"),
    requestId: text("request_id"),
    issue: json<GitHubIssueRef>("issue"),
    pr: json<GitHubPrRef>("pr"),
    automationRunId: text("automation_run_id"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    resolvedAt: text("resolved_at"),
    resolution: json<JsonValue>("resolution"),
  },
  (t) => [index("inbox_status").on(t.status)],
);

export const automations = sqliteTable("automations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull(),
  templateId: text("template_id"),
  trigger: json<Automation["trigger"]>("trigger").notNull(),
  action: json<Automation["action"]>("action").notNull(),
  target: json<Automation["target"]>("target").notNull(),
  guards: json<Automation["guards"]>("guards").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id").notNull(),
    projectId: text("project_id"),
    status: text("status").notNull(),
    triggeredBy: text("triggered_by").notNull(),
    startedBy: json<StartedBy>("started_by").notNull(),
    purpose: text("purpose").notNull(),
    workKey: text("work_key").notNull(),
    scope: json<WorkScope>("scope").notNull(),
    progress: json<WorkProgress>("progress"),
    skipReason: text("skip_reason").$type<AutomationRun["skipReason"]>(),
    sessionId: text("session_id"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    error: json<ErrorInfo>("error"),
  },
  (t) => [
    index("automation_runs_automation").on(t.automationId, t.startedAt),
    index("automation_runs_work_key").on(t.projectId, t.workKey),
  ],
);

export const githubIssues = sqliteTable(
  "github_issues",
  {
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    url: text("url").notNull(),
    labels: json<string[]>("labels").notNull(),
    author: text("author"),
    etag: text("etag"),
    updatedAt: text("updated_at").notNull(),
    syncedAt: text("synced_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.number] })],
);

export const githubPrs = sqliteTable(
  "github_prs",
  {
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    state: text("state").notNull(),
    url: text("url").notNull(),
    headBranch: text("head_branch").notNull(),
    baseBranch: text("base_branch").notNull(),
    checks: text("checks"),
    sessionId: text("session_id"),
    etag: text("etag"),
    updatedAt: text("updated_at").notNull(),
    syncedAt: text("synced_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.number] })],
);

export const artifacts = sqliteTable("artifacts", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  mediaType: text("media_type").notNull(),
  path: text("path").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256"),
  projectId: text("project_id"),
  sessionId: text("session_id"),
  threadId: text("thread_id"),
  itemId: text("item_id"),
  createdAt: text("created_at").notNull(),
});

/** Highest runner event seq durably stored, per runner id (drives `resume` and acks). */
export const runnerState = sqliteTable("runner_state", {
  runnerId: text("runner_id").primaryKey(),
  lastAckedSeq: integer("last_acked_seq").notNull().default(0),
  updatedAt: text("updated_at").notNull(),
});
