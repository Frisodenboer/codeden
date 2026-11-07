import { homedir } from "node:os";
import { join } from "node:path";
import type { Db } from "../db/client";
import type { EventStore } from "../events/store";
import { ToolRegistry } from "../mcp/registry";
import { McpTokenStore } from "../mcp/tokens";
import { allTools } from "../mcp/tools";
import type { HomePaths } from "../paths";
import type { SettingsStore } from "../settings-store";
import { ArtifactService } from "./artifacts";
import { type Exec, runTool } from "./exec";
import { ConfigFiles } from "./files/config-files";
import { InboxService } from "./inbox-service";
import { ProjectService } from "./projects/project-service";
import type { RunnerPort } from "./runner-port";
import type { SecretStore } from "./secrets";
import { SessionLauncher } from "./sessions/launcher";
import { SessionLifecycle } from "./sessions/lifecycle";
import { Outbox } from "./sessions/outbox";
import { QuestionBroker } from "./sessions/questions";
import { SessionRecovery } from "./sessions/recovery";
import { SessionRepo } from "./sessions/repo";
import { SessionService } from "./sessions/session-service";
import { SetupService } from "./setup/setup-service";
import { NoopUtilityService, type UtilityService } from "./utility";

export interface ServicesOptions {
  db: Db;
  store: EventStore;
  settings: SettingsStore;
  paths: HomePaths;
  runner: RunnerPort;
  secrets: SecretStore;
  exec?: Exec;
  utility?: UtilityService;
  /** Default clone location (`~/codeden-projects`). */
  projectsDir?: string;
  /** User home for provider config roots (`~/.claude`, `~/.codex`). */
  userHome?: string;
  /** How long `ask_user` waits before returning "pending" (default 4 minutes). */
  askUserWaitMs?: number;
  log?: (message: string) => void;
}

/** Every application service, wired together. Routes and the realtime hub use these. */
export interface AppServices {
  db: Db;
  store: EventStore;
  settings: SettingsStore;
  paths: HomePaths;
  runner: RunnerPort;
  secrets: SecretStore;
  utility: UtilityService;
  projects: ProjectService;
  sessionRepo: SessionRepo;
  sessions: SessionService;
  lifecycle: SessionLifecycle;
  recovery: SessionRecovery;
  questions: QuestionBroker;
  mcpTokens: McpTokenStore;
  /** CodeDen's tool registry (§8.3), exposed over MCP and to API handlers. */
  tools: ToolRegistry;
  inbox: InboxService;
  artifacts: ArtifactService;
  setup: SetupService;
  configFiles: ConfigFiles;
  userHome: string;
}

export function createServices(opts: ServicesOptions): AppServices {
  const exec = opts.exec ?? runTool;
  const userHome = opts.userHome ?? homedir();
  const utility = opts.utility ?? new NoopUtilityService();
  const projects = new ProjectService({
    db: opts.db,
    store: opts.store,
    exec,
    projectsDir: opts.projectsDir ?? join(userHome, "codeden-projects"),
  });
  const sessionRepo = new SessionRepo(opts.db, opts.store);
  const artifacts = new ArtifactService(opts.db, opts.store, opts.paths.artifacts);
  const outbox = new Outbox(opts.db, opts.store);
  const mcpTokens = new McpTokenStore(opts.db);
  const questions = new QuestionBroker({
    db: opts.db,
    store: opts.store,
    waitMs: opts.askUserWaitMs,
    sendMessage: () => async (sessionId, text) => {
      await sessions?.send(sessionId, { input: { text, attachments: [] }, whenBusy: "queue" });
    },
  });
  let sessions: SessionService | undefined;
  const inbox = new InboxService(opts.db, opts.store, () => (sessionId, requestId, response) => {
    if (!sessions) throw new Error("Session service not ready");
    return sessions.respond(sessionId, { requestId, response });
  });
  const launcher = new SessionLauncher({
    repo: sessionRepo,
    projects,
    runner: opts.runner,
    inbox,
    worktreesDir: opts.paths.worktrees,
    orchestratorDir: opts.paths.orchestrator,
    tokens: mcpTokens,
    log: opts.log,
  });
  sessions = new SessionService({
    repo: sessionRepo,
    projects,
    runner: opts.runner,
    inbox,
    artifacts,
    settings: opts.settings,
    launcher,
    outbox,
    questions,
  });
  const lifecycle = new SessionLifecycle({
    db: opts.db,
    store: opts.store,
    repo: sessionRepo,
    sessions,
    settings: opts.settings,
    utility,
    tokens: mcpTokens,
    log: opts.log,
  });
  const services: AppServices = {
    db: opts.db,
    store: opts.store,
    settings: opts.settings,
    paths: opts.paths,
    runner: opts.runner,
    secrets: opts.secrets,
    utility,
    projects,
    sessionRepo,
    sessions,
    lifecycle,
    recovery: new SessionRecovery({
      repo: sessionRepo,
      sessions,
      launcher,
      runner: opts.runner,
      log: opts.log,
    }),
    inbox,
    artifacts,
    setup: new SetupService({ exec, settings: opts.settings }),
    configFiles: new ConfigFiles({
      projects,
      home: userHome,
      backupDir: join(opts.paths.backups, "files"),
    }),
    userHome,
    questions,
    mcpTokens,
    tools: undefined as unknown as ToolRegistry,
  };
  services.tools = new ToolRegistry(allTools, services, opts.log);
  return services;
}
