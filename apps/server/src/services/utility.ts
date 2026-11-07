import type {
  FollowupSuggestion,
  Session,
  Settings,
  SpeechSummaryResponse,
} from "@codeden/contracts";
import type { RunnerPort } from "./runner-port";

/** Context handed to utility jobs about a finished turn. */
export interface TurnContext {
  session: Session;
  /** The turn's final assistant message, if any. */
  finalMessage: string | null;
  /** The first user message of the session, when known. */
  firstMessage?: string | null;
  /** Files the turn changed, when known. */
  changedFiles?: string[];
}

/**
 * Small side jobs on the utility model (§7.4): session titles, follow-up suggestions when the
 * agent did not call `suggest_followups` (§7.5), and read-aloud summaries (§11.3). Jobs return
 * null for "nothing to add" and never throw: a failing side job must not break a session.
 */
export interface UtilityService {
  sessionTitle(ctx: TurnContext): Promise<string | null>;
  suggestFollowups(ctx: TurnContext): Promise<FollowupSuggestion[] | null>;
  /** One or two sentences for text-to-speech; falls back to the cleaned text itself. */
  speechSummary(text: string): Promise<SpeechSummaryResponse>;
}

/** A `UtilityService` that never calls a model (tests, no providers). */
export class NoopUtilityService implements UtilityService {
  async sessionTitle(): Promise<string | null> {
    return null;
  }
  async suggestFollowups(): Promise<FollowupSuggestion[] | null> {
    return null;
  }
  async speechSummary(text: string): Promise<SpeechSummaryResponse> {
    return { text: plainSpeech(text), source: "plain" };
  }
}

/** Strip code blocks and markdown so text reads naturally aloud (§11.3). */
export function plainSpeech(text: string, maxChars = 600): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_~>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= maxChars) return plain;
  const cut = plain.slice(0, maxChars);
  const end = cut.lastIndexOf(". ");
  return end > maxChars / 2 ? cut.slice(0, end + 1) : `${cut.trimEnd()}...`;
}

/** Utility-model calls through the runner (`provider.oneShot`), so the server spawns nothing. */
export interface OneShotPort {
  oneShot(
    providerId: string,
    req: { prompt: string; system?: string; model?: string; timeoutMs?: number },
  ): Promise<string>;
  /** Providers that can run one-shots, in preference order. */
  available(): string[];
}

export function runnerOneShot(runner: RunnerPort): OneShotPort {
  return {
    oneShot: async (providerId, req) =>
      (
        await runner.request(
          { name: "provider.oneShot", providerId, ...req },
          (req.timeoutMs ?? 60_000) + 5_000,
        )
      ).text,
    available: () => runner.providers().map((p) => p.id),
  };
}

const PREFERENCE = ["claude", "codex"];
const TIMEOUT_MS = 60_000;

/**
 * The real `UtilityService`: a one-shot, tool-less call on a small model (§7.4). The provider
 * comes from settings (`auto` = Claude, then Codex); when the chosen provider fails, the
 * other one is tried. Each job can be switched off in settings.
 */
export class ProviderUtilityService implements UtilityService {
  constructor(
    private readonly deps: {
      settings: () => Settings;
      oneShot: OneShotPort;
      log?: (message: string) => void;
    },
  ) {}

  async sessionTitle(ctx: TurnContext): Promise<string | null> {
    if (!this.deps.settings().utilityModel.jobs.sessionTitles) return null;
    const source = ctx.firstMessage ?? ctx.finalMessage;
    if (!source) return null;
    const out = await this.run(
      "Write a title of 3 to 6 words for a coding session that starts with the request below. Reply with the title only: no quotes, no trailing punctuation.",
      `Request:\n${clip(source, 4_000)}`,
    );
    const title = out
      ?.split("\n")[0]
      ?.replace(/^["'#\s]+|["'.\s]+$/g, "")
      .slice(0, 80);
    return title ? title : null;
  }

  async suggestFollowups(ctx: TurnContext): Promise<FollowupSuggestion[] | null> {
    if (!this.deps.settings().utilityModel.jobs.followups || !ctx.finalMessage) return null;
    const files = ctx.changedFiles?.length ? `\nFiles changed: ${ctx.changedFiles.join(", ")}` : "";
    const out = await this.run(
      "You suggest what a developer might ask a coding agent next. Reply with 2 to 4 short prompts, one per line, written as the developer would type them. No numbering, no quotes, nothing else.",
      `The agent's final message:\n${clip(ctx.finalMessage, 6_000)}${files}`,
    );
    const lines = (out ?? "")
      .split("\n")
      .map((l) =>
        l
          .replace(/^\s*(?:[-*\d.)]+\s*)?/, "")
          .replace(/^["']|["']$/g, "")
          .trim(),
      )
      .filter((l) => l.length > 0 && l.length <= 300)
      .slice(0, 4);
    return lines.length >= 2 ? lines.map((prompt) => ({ prompt })) : null;
  }

  async speechSummary(text: string): Promise<SpeechSummaryResponse> {
    const plain = plainSpeech(text, 4_000);
    if (!this.deps.settings().utilityModel.jobs.readAloudSummary || plain.length <= 240) {
      return { text: plainSpeech(text), source: "plain" };
    }
    const out = await this.run(
      "Compress the message below into one or two plain sentences that will be read aloud. No markdown, no code, no lists.",
      plain,
    );
    return out
      ? { text: out.trim(), source: "utility" }
      : { text: plainSpeech(text), source: "plain" };
  }

  /** One-shot on the configured provider, falling back to the next; null on failure. */
  private async run(system: string, prompt: string): Promise<string | null> {
    const { utilityModel } = this.deps.settings();
    const available = this.deps.oneShot.available();
    const chosen = utilityModel.provider === "auto" ? null : utilityModel.provider;
    const order = [chosen, ...PREFERENCE].filter(
      (id, i, all): id is string => !!id && available.includes(id) && all.indexOf(id) === i,
    );
    for (const providerId of order) {
      try {
        const model = providerId === chosen ? (utilityModel.model ?? undefined) : undefined;
        const text = await this.deps.oneShot.oneShot(providerId, {
          prompt,
          system,
          model,
          timeoutMs: TIMEOUT_MS,
        });
        if (text.trim()) return text.trim();
      } catch (error) {
        this.deps.log?.(
          `utility: ${providerId} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return null;
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
