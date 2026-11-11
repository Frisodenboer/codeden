import { readFileSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import {
  AgentEvent,
  type AutonomyLevel,
  ProviderCapabilities,
  RuntimeResponse,
  UserInput,
} from "@codeden/contracts";

/** One recorded turn: the input sent, every event until the next send, and the answers given. */
export interface ReplayTurn {
  input: UserInput;
  events: AgentEvent[];
  /** Responses given to approval/question requests, keyed by request id. */
  responses: Record<string, RuntimeResponse>;
}

/**
 * A recorded provider session (§7.2 Replay). Paths under the recording's cwd and the CodeDen
 * session id are replaced with placeholders so fixtures are portable and replay deterministic.
 */
export interface ReplayFixture {
  version: 1;
  provider: string;
  scenario: string;
  recordedAt: string;
  cliVersion: string | null;
  autonomy: AutonomyLevel;
  model: string | null;
  capabilities: ProviderCapabilities;
  /** Events emitted before the first `send` (thread.started, session.updated). */
  preamble: AgentEvent[];
  turns: ReplayTurn[];
}

export const CWD_PLACEHOLDER = "<CWD>";
export const SESSION_PLACEHOLDER = "<SESSION>";

/** JSON string body for a raw string (what it looks like inside a JSON document). */
const jsonBody = (s: string) => JSON.stringify(s).slice(1, -1);

function replaceAll(text: string, from: string, to: string): string {
  return from ? text.split(from).join(to) : text;
}

/**
 * Replace the recording cwd and session id with placeholders, and the OS user name (which
 * still shows up in streamed path fragments) with `user`.
 */
export function sanitizeFixture(
  fixture: ReplayFixture,
  cwd: string,
  sessionId: string,
  userName = safeUserName(),
): ReplayFixture {
  let text = JSON.stringify(fixture);
  for (const variant of new Set([cwd, cwd.replace(/\\/g, "/")])) {
    text = replaceAll(text, jsonBody(variant), CWD_PLACEHOLDER);
  }
  text = replaceAll(text, jsonBody(sessionId), SESSION_PLACEHOLDER);
  if (userName && userName.length >= 3) {
    text = text.replace(
      new RegExp(`(?<=[\\\\/])${escapeRegExp(userName)}(?=[\\\\/])`, "g"),
      "user",
    );
  }
  return JSON.parse(text) as ReplayFixture;
}

function safeUserName(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Substitute placeholders for a replay session's cwd and session id. */
export function instantiateFixture(
  fixture: ReplayFixture,
  cwd: string,
  sessionId: string,
): ReplayFixture {
  let text = JSON.stringify(fixture);
  text = replaceAll(text, CWD_PLACEHOLDER, jsonBody(cwd));
  text = replaceAll(text, SESSION_PLACEHOLDER, jsonBody(sessionId));
  return JSON.parse(text) as ReplayFixture;
}

/** Validate a parsed fixture: every event, input and response must satisfy the contracts. */
export function parseFixture(value: unknown): ReplayFixture {
  const f = value as ReplayFixture;
  if (f?.version !== 1 || !Array.isArray(f.turns) || !Array.isArray(f.preamble)) {
    throw new Error("Not a CodeBench replay fixture (version 1)");
  }
  ProviderCapabilities.parse(f.capabilities);
  for (const event of f.preamble) AgentEvent.parse(event);
  for (const turn of f.turns) {
    UserInput.parse(turn.input);
    for (const event of turn.events) AgentEvent.parse(event);
    for (const response of Object.values(turn.responses)) RuntimeResponse.parse(response);
  }
  return f;
}

export function loadFixture(path: string): ReplayFixture {
  return parseFixture(JSON.parse(readFileSync(path, "utf8")));
}

export function saveFixture(path: string, fixture: ReplayFixture): void {
  writeFileSync(path, `${JSON.stringify(fixture, null, 1)}\n`);
}
