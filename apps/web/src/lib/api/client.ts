import type {
  ConflictDecision,
  InboxItem,
  Project,
  RuntimeResponse,
  ServerToClientMessage,
  SessionSnapshot,
  Settings,
  SettingsPatch,
  Snapshot,
  StartWorkResult,
  UserInputInit,
} from "@codeden/contracts";
import type {
  BrowserChannel,
  ConflictCase,
  CreateProjectInput,
  DiffResult,
  DiffScope,
  DirListing,
  FactoryStatus,
  FileContent,
  FileNode,
  LoadedContext,
  McpServerEntry,
  MemoryFile,
  MentionCandidate,
  PrDetails,
  SetupCheckId,
  SetupStatus,
  SkillEntry,
  SlashCommand,
  StartSessionInput,
  SubagentEntry,
  TerminalChannel,
} from "./types";

/** How a message is delivered while a turn is running. */
export type SendMode = "send" | "queue" | "steer";

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
  /** Subscribe to the live event stream. Returns an unsubscribe function. */
  subscribe(fromSeq: number, onMessage: (msg: ServerToClientMessage) => void): () => void;

  // Sessions and turns.
  sendMessage(sessionId: string, input: UserInputInit, mode: SendMode): Promise<void>;
  interrupt(sessionId: string): Promise<void>;
  respond(sessionId: string, requestId: string, response: RuntimeResponse): Promise<void>;
  startSession(input: StartSessionInput): Promise<StartWorkResult>;
  stopSession(sessionId: string): Promise<void>;

  // Conflicts (§8.4).
  listConflicts(): Promise<ConflictCase[]>;
  resolveConflict(conflictId: string, decision: ConflictDecision): Promise<void>;

  // Inbox (§11.1).
  resolveInbox(itemId: string, resolution: { action: string; note?: string }): Promise<InboxItem>;

  // Projects, automations, factory.
  createProject(input: CreateProjectInput): Promise<Project>;
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
  getSetupStatus(): Promise<SetupStatus>;
  recheckSetup(id?: SetupCheckId): Promise<SetupStatus>;
  completeSetup(): Promise<void>;
  listDirectory(path: string | null): Promise<DirListing>;

  // Workbench (§12).
  getDiff(sessionId: string, scope: DiffScope): Promise<DiffResult>;
  listFiles(sessionId: string): Promise<FileNode[]>;
  readFile(sessionId: string, path: string): Promise<FileContent>;
  getPrDetails(sessionId: string): Promise<PrDetails>;
  getLoadedContext(sessionId: string): Promise<LoadedContext>;
  searchMentions(sessionId: string, query: string): Promise<MentionCandidate[]>;
  listSlashCommands(sessionId: string): Promise<SlashCommand[]>;
  openTerminal(opts: { sessionId: string | null; command?: string }): TerminalChannel;
  openBrowser(sessionId: string): BrowserChannel;
  /** URL for an artifact's bytes (screenshots, generated images, attachments). */
  artifactUrl(artifactId: string): string;

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
