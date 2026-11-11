import { join } from "node:path";
import { z } from "zod";
import { PlannerStore } from "../../services/planner/planner-store";
import { type AnyServerTool, defineTool } from "../define";

/**
 * `add_follow_up`: put something the user still has to do on their Follow-ups list, so it
 * doesn't get lost in the chat (switch an automation on, approve a PR, log in, check a page).
 */
export const addFollowUp = defineTool({
  name: "add_follow_up",
  description:
    "Add an item to the user's Follow-ups list in CodeBench: something THEY still have to do themselves, which you asked or advised in your reply (for example: switch on an automation once it appears, approve or merge a pull request, sign in to a tool, check a page, decide something). Call it every time you hand the user an action, in the same turn, with a short imperative title (max ~80 characters) and the details they need. Don't add things you will do yourself (use schedule_wakeup for your own follow-ups). Adding the same open title twice is ignored.",
  roles: ["orchestrator", "pm", "agent"],
  scope: "session",
  alwaysLoad: true,
  input: z.object({
    title: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe("What the user should do, e.g. 'Switch on the Monday GBP automation'"),
    detail: z
      .string()
      .max(2000)
      .optional()
      .describe("Where and how: the page, setting or command, and why"),
  }),
  handler: async ({ title, detail }, ctx) => {
    const store = new PlannerStore(join(ctx.services.paths.home, "planner.json"));
    const item = store.addFollowUp(
      { title, detail: detail ?? "", projectId: ctx.projectId },
      { addedBy: ctx.role as "orchestrator" | "pm" | "agent", sessionId: ctx.sessionId },
    );
    return `Added to the user's Follow-ups list (${item.id}). No need to repeat it in detail; mention it briefly.`;
  },
});

/** The follow-up tools: available to every role. */
export const followUpTools: AnyServerTool[] = [addFollowUp];
