import type {
  ConflictDecision,
  ConflictRecord,
  CreateProjectRequest,
  CreateProjectResponse,
  DiffResult,
  DiffScope,
  FsListResponse,
  GitCommitRequest,
  GitCommitResponse,
  GitPushRequest,
  GitPushResponse,
  GitStatusResponse,
  InboxItem,
  LoginCommandResponse,
  ResolveConflictResponse,
  RestoreFilesRequest,
  RestoreFilesResponse,
  RuntimeResponse,
  Session,
  SessionDetail,
  SessionFileContent,
  SessionFileList,
  SessionSnapshot,
  Settings,
  SettingsPatch,
  SetupStatus,
  Snapshot,
  SpeechSummaryResponse,
  StartSessionRequestInit,
  StartSessionResponse,
  TranscriptMessage,
  UiServerMessage,
  UpdateSessionRequest,
  UserInputInit,
} from "@codeden/contracts";
import type {
  AgentConfigApi,
  BrowserApi,
  GithubApi,
  ImagesApi,
  OrchestrationApi,
  SecretsApi,
  VoiceApi,
} from "./feature-apis";
import type {
  FactoryStatus,
  MentionCandidate,
  OpenTerminalOptions,
  SlashCommand,
  TerminalChannel,
} from "./types";

/** How a message is delivered while a turn is running. */
export type SendMode = "send" | "queue" | "steer";

/** Messages for one watched session transcript. */
export type TranscriptWatchMessage =
  | TranscriptMessage
  | { type: "transcript_resync"; sessionId: string; seq: number };

/** Resolve an inbox item; approvals and questions carry the agent `response`. */
export interface InboxResolution {
  status?: "resolved" | "dismissed";
  response?: RuntimeResponse;
  note?: string;
}

/**
 * Everything the UI asks of the server. Two implementations: `createHttpClient` (fetch +
 * WebSocket against the real server) and `createMockClient` (rich fixtures, scripted live
 * events). Screens only ever talk to this interface.
 */
export interface CodeDenClient {
  readonly kind: "http" | "mock";

  // Realtime (§6): snapshot, then subscribe from its seq.
  getSnapshot(): Promise<Snapshot>;
  getSessionSnapshot(sessionId: string): Promise<SessionSnapshot>;
  /**
   * Subscribe to the live event stream (domain events; the mock also sends agent events).
   * Calling it again replaces the subscription. Returns an unsubscribe function.
   */
  subscribe(fromSeq: number, onMessage: (msg: UiServerMessage) => void): () => void;
  /** Watch one session's transcript from `fromSeq` (its snapshot seq). Returns unwatch. */
  watchSession(
    sessionId: string,
    fromSeq: number,
    onMessage: (msg: TranscriptWatchMessage) => void,
  ): () => void;

  /** Live connection state of the realtime socket. Returns an unsubscribe function. */
  onConnectionChange(listener: (state: "connecting" | "open" | "closed") => void): () => void;

  // Sessions and turns.
  getSessionDetail(sessionId: string): Promise<SessionDetail>;
  sendMessage(sessionId: string, input: UserInputInit, mode: SendMode): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  respond(sessionId: string, requestId: string, response: RuntimeResponse): Promise<void>;
  startSession(input: StartSessionRequestInit): Promise<StartSessionResponse>;
  stopSession(sessionId: string): Promise<void>;
  /** Change model, effort or title; model and effort apply from the next turn. */
  updateSession(sessionId: string, patch: UpdateSessionRequest): Promise<Session>;

  // Conflicts (§8.4): persisted start requests that matched running work.
  listConflicts(query?: { projectId?: string }): Promise<ConflictRecord[]>;
  resolveConflict(conflictId: string, decision: ConflictDecision): Promise<ResolveConflictResponse>;

  // Inbox (§11.1).
  resolveInbox(itemId: string, resolution: InboxResolution): Promise<InboxItem>;

  // Projects, automations, factory.
  createProject(input: CreateProjectRequest): Promise<CreateProjectResponse>;
  setAutomationEnabled(automationId: string, enabled: boolean): Promise<void>;
  skipNextRun(automationId: string): Promise<void>;
  getFactoryStatus(projectId: string): Promise<FactoryStatus>;
  setKillSwitch(scope: { projectId: string } | "global", on: boolean): Promise<void>;
  readVision(projectId: string): Promise<string>;
  writeVision(projectId: string, contents: string): Promise<void>;

  // Settings.
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  /** OS keychain secrets (API keys). Values are never echoed back. */
  readonly secrets: SecretsApi;

  // First-run setup (§14).
  /** Detection results; `refresh` re-runs every check instead of using the cache. */
  getSetupStatus(opts?: { refresh?: boolean }): Promise<SetupStatus>;
  loginCommand(tool: "claude" | "codex" | "gh"): Promise<LoginCommandResponse>;
  completeSetup(): Promise<void>;
  listDirectory(path: string | null, opts?: { showHidden?: boolean }): Promise<FsListResponse>;

  // Workbench (§12).
  getDiff(sessionId: string, scope: DiffScope): Promise<DiffResult>;
  restoreFiles(sessionId: string, req: RestoreFilesRequest): Promise<RestoreFilesResponse>;
  gitStatus(sessionId: string): Promise<GitStatusResponse>;
  gitCommit(sessionId: string, req: GitCommitRequest): Promise<GitCommitResponse>;
  gitPush(sessionId: string, req: GitPushRequest): Promise<GitPushResponse>;
  listFiles(sessionId: string): Promise<SessionFileList>;
  readFile(sessionId: string, path: string): Promise<SessionFileContent>;
  searchMentions(sessionId: string, query: string): Promise<MentionCandidate[]>;
  listSlashCommands(sessionId: string): Promise<SlashCommand[]>;
  openTerminal(opts: OpenTerminalOptions): TerminalChannel;
  /** The session browser: live viewer socket, tabs, navigation, dev servers (§12.2). */
  readonly browser: BrowserApi;
  /** URL for an artifact's bytes (screenshots, generated images, attachments). */
  artifactUrl(artifactId: string): string;
  /** Compress a final message for read-aloud with the utility model (§11.3). */
  speechSummary(text: string): Promise<SpeechSummaryResponse>;

  // Agent configuration (§12.4), image generation (§12.5), cloud voice (§11.3).
  readonly agentConfig: AgentConfigApi;
  readonly images: ImagesApi;
  readonly voice: VoiceApi;

  // Orchestration (§8) and GitHub (§9).
  readonly orchestration: OrchestrationApi;
  readonly github: GithubApi;
}
