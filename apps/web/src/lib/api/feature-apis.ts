import type {
  AgentConfigDeleteResponse,
  AgentConfigDiff,
  AgentConfigDiffRequest,
  AgentConfigFileContent,
  AgentConfigListQuery,
  AgentConfigListResponse,
  AgentConfigLocator,
  AgentConfigWriteRequest,
  AgentConfigWriteResponse,
  BrowserHistoryRequest,
  BrowserInput,
  BrowserNavigateResponse,
  BrowserOpenResponse,
  BrowserScreencastSettings,
  BrowserServerMessage,
  BrowserTabResponse,
  BrowserTabsResponse,
  DevServersResponse,
  ImageEnginesResponse,
  ImageTestRequest,
  ImageTestResponse,
  LoadedAgentConfig,
  McpServerDiffRequest,
  McpServerListResponse,
  McpServerTarget,
  McpServerUpsertRequest,
  McpServerWriteResponse,
  SecretKey,
  SecretsStatus,
  SttQuery,
  SttResponse,
  TtsRequest,
  VoiceListResponse,
} from "@codeden/contracts";

/**
 * Feature APIs of the client that map one-to-one onto server routes: the session browser
 * (§12.2), agent configuration (§12.4), image generation (§12.5), cloud voice (§11.3) and
 * keychain secrets. Shapes are the contracts' own.
 */

// ------------------------------------------------------------------ session browser (§12.2)

export type BrowserConnection = "connecting" | "open" | "closed";

/** Options for the `/ws/browser` viewer socket. */
export interface BrowserChannelOptions extends BrowserScreencastSettings {
  /** Open the session's browser if it is not open yet. */
  open?: boolean;
}

/** One live viewer of a session's browser (`/ws/browser`). */
export interface BrowserChannel {
  onMessage(listener: (msg: BrowserServerMessage) => void): () => void;
  onConnection(listener: (state: BrowserConnection) => void): () => void;
  /** Human input for the active tab (coordinates in displayed-frame space). */
  input(input: BrowserInput): void;
  watch(settings?: BrowserScreencastSettings): void;
  unwatch(): void;
  /** Open the session's browser now (optionally at `url`). */
  open(url?: string): void;
  close(): void;
}

export interface BrowserApi {
  openChannel(sessionId: string, opts?: BrowserChannelOptions): BrowserChannel;
  open(sessionId: string, url?: string): Promise<BrowserOpenResponse>;
  close(sessionId: string): Promise<void>;
  tabs(sessionId: string): Promise<BrowserTabsResponse>;
  newTab(sessionId: string, url?: string): Promise<BrowserTabResponse>;
  closeTab(sessionId: string, tabId: string): Promise<void>;
  activateTab(sessionId: string, tabId: string): Promise<void>;
  navigate(sessionId: string, url: string, tabId?: string): Promise<BrowserNavigateResponse>;
  history(
    sessionId: string,
    action: BrowserHistoryRequest["action"],
    tabId?: string,
  ): Promise<{ url: string }>;
  viewport(sessionId: string, width: number, height: number): Promise<void>;
  openDevServer(sessionId: string, port: number, path?: string): Promise<BrowserTabResponse>;
  devServers(probe?: number[]): Promise<DevServersResponse>;
}

// ------------------------------------------------------------------ agent configuration (§12.4)

export interface AgentConfigApi {
  list(query: AgentConfigListQuery): Promise<AgentConfigListResponse>;
  read(locator: AgentConfigLocator): Promise<AgentConfigFileContent>;
  /** Create or overwrite; `create` refuses an existing file (409 `file_exists`). */
  write(
    req: AgentConfigWriteRequest,
    opts?: { create?: boolean },
  ): Promise<AgentConfigWriteResponse>;
  remove(
    locator: AgentConfigLocator,
    opts?: { folder?: boolean },
  ): Promise<AgentConfigDeleteResponse>;
  diff(req: AgentConfigDiffRequest): Promise<AgentConfigDiff>;
  listMcp(projectId: string | null): Promise<McpServerListResponse>;
  upsertMcp(req: McpServerUpsertRequest): Promise<McpServerWriteResponse>;
  removeMcp(target: McpServerTarget): Promise<McpServerWriteResponse>;
  /** Preview an upsert (with `spec`) or a removal (without). */
  diffMcp(req: McpServerDiffRequest): Promise<AgentConfigDiff>;
  /** What a session's provider loads from its working directory. */
  loaded(sessionId: string): Promise<LoadedAgentConfig>;
}

// ------------------------------------------------------------------ images, voice, secrets

export interface ImagesApi {
  engines(projectId?: string | null): Promise<ImageEnginesResponse>;
  test(req: ImageTestRequest): Promise<ImageTestResponse>;
}

export interface VoiceApi {
  /** ElevenLabs voices (409 `missing_api_key` without a key). */
  voices(): Promise<VoiceListResponse>;
  /** Spoken audio (`audio/mpeg`) from the server's ElevenLabs proxy. */
  tts(req: TtsRequest): Promise<Blob>;
  /** Transcribe recorded audio with a cloud engine. */
  stt(audio: Blob, query: SttQuery): Promise<SttResponse>;
}

export interface SecretsApi {
  status(): Promise<SecretsStatus>;
  set(key: SecretKey, value: string): Promise<void>;
  remove(key: SecretKey): Promise<void>;
}
