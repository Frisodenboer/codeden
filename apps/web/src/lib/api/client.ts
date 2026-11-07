import type {
  ConflictDecision,
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
  RestoreFilesRequest,
  RestoreFilesResponse,
  RuntimeResponse,
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
  UserInputInit,
} from "@codeden/contracts";
import type {
  BrowserChannel,
  ConflictCase,
  FactoryStatus,
  LoadedContext,
  McpServerEntry,
  MemoryFile,
  MentionCandidate,
  OpenTerminalOptions,
  PrDetails,
  SkillEntry,
  SlashCommand,
  SubagentEntry,
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

  // Conflicts (§8.4).
  listConflicts(): Promise<ConflictCase[]>;
  resolveConflict(conflict: ConflictCase, decision: ConflictDecision): Promise<void>;

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
  /** Store a secret (e.g. ElevenLabs key) in the OS keychain. Never echoed back. */
  setSecret(name: string, value: string): Promise<void>;

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
  getPrDetails(sessionId: string): Promise<PrDetails>;
  getLoadedContext(sessionId: string): Promise<LoadedContext>;
  searchMentions(sessionId: string, query: string): Promise<MentionCandidate[]>;
  listSlashCommands(sessionId: string): Promise<SlashCommand[]>;
  openTerminal(opts: OpenTerminalOptions): TerminalChannel;
  openBrowser(sessionId: string): BrowserChannel;
  /** URL for an artifact's bytes (screenshots, generated images, attachments). */
  artifactUrl(artifactId: string): string;
  /** Compress a final message for read-aloud with the utility model (§11.3). */
  speechSummary(text: string): Promise<SpeechSummaryResponse>;

  // Agent configuration (§12.4).
  listMemoryFiles(projectId: string | null): Promise<MemoryFile[]>;
  readConfigFile(path: string): Promise<string>;
  writeConfigFile(path: string, contents: string): Promise<void>;
  listSkills(projectId: string | null): Promise<SkillEntry[]>;
  setSkillEnabled(skillId: string, enabled: boolean): Promise<void>;
  listSubagents(projectId: string | null): Promise<SubagentEntry[]>;
  listMcpServers(projectId: string | null): Promise<McpServerEntry[]>;
  testMcpServer(serverId: string): Promise<{ ok: boolean; message: string }>;
}
