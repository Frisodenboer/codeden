import type { FollowupSuggestion, Session } from "@codeden/contracts";

/** Context handed to utility jobs about a finished turn. */
export interface TurnContext {
  session: Session;
  /** The turn's final assistant message, if any. */
  finalMessage: string | null;
}

/**
 * Small side jobs on the utility model (§7.4): session titles, follow-up suggestions when the
 * agent did not call `suggest_followups` (§7.5), and read-aloud summaries (§11.3). Every
 * method may return null ("nothing to add"). The default implementation does nothing; a real
 * one runs a one-shot, tool-less call through an installed provider.
 */
export interface UtilityService {
  sessionTitle(ctx: TurnContext): Promise<string | null>;
  suggestFollowups(ctx: TurnContext): Promise<FollowupSuggestion[] | null>;
  readAloudSummary(text: string): Promise<string | null>;
}

/** The default `UtilityService`: every job is a no-op. */
export class NoopUtilityService implements UtilityService {
  async sessionTitle(): Promise<string | null> {
    return null;
  }
  async suggestFollowups(): Promise<FollowupSuggestion[] | null> {
    return null;
  }
  async readAloudSummary(): Promise<string | null> {
    return null;
  }
}
