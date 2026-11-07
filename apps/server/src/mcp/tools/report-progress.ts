import { z } from "zod";
import { defineTool } from "../define";

/** `report_progress` (§8.3, §8.4): the session's one-line status, shown to PMs and the UI. */
export const reportProgress = defineTool({
  name: "report_progress",
  description:
    "Report what you are doing right now in one short line (for example 'Writing tests for the parser, 3 of 5 passing'). Call it when you start a new phase of work. It updates the status the user and project manager see; it does not end your turn.",
  roles: ["agent"],
  scope: "session",
  alwaysLoad: true,
  input: z.object({
    text: z.string().min(1).max(500).describe("One line describing the current progress"),
  }),
  handler: async ({ text }, { services, sessionId }) => {
    const at = new Date().toISOString();
    services.sessionRepo.update(sessionId, (s) => ({ ...s, progress: { text, at } }));
    return "Progress recorded.";
  },
});
