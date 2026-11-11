/**
 * The parts of opencode's HTTP API (`opencode serve`, OpenAPI at `/doc`) that CodeBench uses,
 * written by hand from opencode 1.18. Fields are optional where older or newer servers may
 * leave them out, and unknown event types are ignored, so API drift degrades instead of
 * breaking (docs/plans/opencode-provider.md, "API drift").
 */

export interface OcTokens {
  total?: number;
  input: number;
  output: number;
  reasoning: number;
  cache: { read: number; write: number };
}

export interface OcError {
  name: string;
  data?: {
    message?: string;
    statusCode?: number;
    isRetryable?: boolean;
    providerID?: string;
    responseBody?: string;
    [key: string]: unknown;
  };
}

export interface OcSession {
  id: string;
  directory: string;
  title?: string;
  model?: { id: string; providerID: string; variant?: string };
  version?: string;
}

export interface OcUserMessage {
  id: string;
  sessionID: string;
  role: "user";
}

export interface OcAssistantMessage {
  id: string;
  sessionID: string;
  role: "assistant";
  modelID?: string;
  providerID?: string;
  cost?: number;
  tokens?: OcTokens;
  error?: OcError;
  finish?: string;
  time?: { created: number; completed?: number };
}

export type OcMessage = OcUserMessage | OcAssistantMessage;

interface PartBase {
  id: string;
  sessionID: string;
  messageID: string;
}

export interface OcTextPart extends PartBase {
  type: "text";
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
  time?: { start: number; end?: number };
}

export interface OcReasoningPart extends PartBase {
  type: "reasoning";
  text: string;
  time?: { start: number; end?: number };
}

export type OcToolState =
  | { status: "pending"; input?: Record<string, unknown>; raw?: string }
  | {
      status: "running";
      input: Record<string, unknown>;
      title?: string;
      metadata?: Record<string, unknown>;
      time: { start: number };
    }
  | {
      status: "completed";
      input: Record<string, unknown>;
      output: string;
      title?: string;
      metadata?: Record<string, unknown>;
      time: { start: number; end: number };
    }
  | {
      status: "error";
      input: Record<string, unknown>;
      error: string;
      metadata?: Record<string, unknown>;
      time: { start: number; end: number };
    };

export interface OcToolPart extends PartBase {
  type: "tool";
  callID: string;
  tool: string;
  state: OcToolState;
}

export interface OcStepFinishPart extends PartBase {
  type: "step-finish";
  reason: string;
  cost: number;
  tokens: OcTokens;
}

/** Parts CodeBench maps; others (step-start, patch, snapshot, file, agent...) pass by. */
export type OcPart =
  | OcTextPart
  | OcReasoningPart
  | OcToolPart
  | OcStepFinishPart
  | (PartBase & { type: string });

export interface OcPermissionRequest {
  id: string;
  sessionID: string;
  /** `edit`, `bash`, `webfetch`, `external_directory`, an MCP tool name... */
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
  always: string[];
  tool?: { messageID: string; callID: string };
}

export interface OcQuestionInfo {
  question: string;
  header: string;
  options: { label: string; description?: string }[];
  multiple?: boolean;
  custom?: boolean;
}

export interface OcQuestionRequest {
  id: string;
  sessionID: string;
  questions: OcQuestionInfo[];
  tool?: { messageID: string; callID: string };
}

export type OcSessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };

export interface OcTodo {
  id?: string;
  content: string;
  status: string;
  priority?: string;
}

/** An event from `GET /event`. `properties` is typed per event; unknown types are kept loose. */
export type OcEvent =
  | { type: "message.updated"; properties: { sessionID: string; info: OcMessage } }
  | { type: "message.part.updated"; properties: { sessionID: string; part: OcPart } }
  | {
      type: "message.part.delta";
      properties: {
        sessionID: string;
        messageID: string;
        partID: string;
        field: string;
        delta: string;
      };
    }
  | { type: "session.status"; properties: { sessionID: string; status: OcSessionStatus } }
  | { type: "session.idle"; properties: { sessionID: string } }
  | { type: "session.error"; properties: { sessionID?: string; error?: OcError } }
  | { type: "session.compacted"; properties: { sessionID: string } }
  | { type: "session.updated"; properties: { sessionID: string; info: OcSession } }
  | { type: "todo.updated"; properties: { sessionID: string; todos: OcTodo[] } }
  | { type: "permission.asked"; properties: OcPermissionRequest }
  | { type: "question.asked"; properties: OcQuestionRequest }
  | { type: "other"; properties: Record<string, unknown> };

export interface OcModel {
  id: string;
  providerID: string;
  name: string;
  status?: string;
  limit?: { context: number; input?: number; output: number };
  capabilities?: { reasoning?: boolean; input?: { image?: boolean } };
  variants?: Record<string, unknown>;
}

export interface OcProvider {
  id: string;
  name: string;
  source?: string;
  models: Record<string, OcModel>;
}

export interface OcProvidersResponse {
  providers: OcProvider[];
  /** Default model id per provider id. */
  default: Record<string, string>;
}

export type OcPartInput =
  | { type: "text"; text: string; synthetic?: boolean }
  | { type: "file"; mime: string; url: string; filename?: string };

export interface OcPermissionRule {
  permission: string;
  pattern: string;
  action: "allow" | "ask" | "deny";
}

export interface OcCommand {
  name: string;
  description?: string;
  agent?: string;
  model?: string;
  source?: "command" | "mcp" | "skill";
  template: string;
  hints: string[];
}

/** The session id an event belongs to, when it carries one. */
export function eventSessionId(event: OcEvent): string | undefined {
  const p = event.properties as Record<string, unknown> | undefined;
  return typeof p?.sessionID === "string" ? p.sessionID : undefined;
}
