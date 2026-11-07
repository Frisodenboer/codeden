import { z } from "zod";
import { defineTool } from "../define";
import { currentTurn, putTurnItem } from "../transcript";

/** `suggest_followups` (§7.5): next prompts shown as chips when the turn completes. */
export const suggestFollowups = defineTool({
  name: "suggest_followups",
  description:
    "Suggest 2 to 4 short next prompts the user might send after this turn, written as the user would type them (for example 'Add tests for the empty-input case'). Call it as the last action of every turn. Calling it again in the same turn replaces the earlier suggestions.",
  roles: ["agent"],
  scope: "session",
  alwaysLoad: true,
  input: z.object({
    suggestions: z
      .array(z.string().min(1).max(300))
      .min(2)
      .max(4)
      .describe("2-4 follow-up prompts, most useful first"),
  }),
  handler: async ({ suggestions }, { services, sessionId }) => {
    const turn = currentTurn(services, sessionId);
    putTurnItem(services, sessionId, turn, {
      id: `followups-${turn.turnId}`,
      kind: "followups",
      status: "completed",
      source: "agent",
      suggestions: suggestions.map((prompt) => ({ prompt })),
    });
    return "Follow-ups saved; they are shown to the user when the turn ends.";
  },
});
