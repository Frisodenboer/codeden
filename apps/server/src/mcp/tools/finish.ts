import { SessionResult } from "@codeden/contracts";
import { z } from "zod";
import { defineTool } from "../define";

/** `finish` (§8.3): the structured result of the session's work. */
export const finish = defineTool({
  name: "finish",
  description:
    "Record the result of your assigned work once it is done (or cannot be done): an outcome, a short summary, and optionally changed files, tests run and next steps. Call it once when the task is complete; you can still answer follow-up messages afterwards.",
  roles: ["agent"],
  scope: "session",
  alwaysLoad: true,
  input: SessionResult.omit({ at: true }).extend({
    summary: z.string().min(1).max(4_000).describe("What was done, in a few sentences"),
  }),
  handler: async (input, { services, sessionId }) => {
    const result = { ...input, at: new Date().toISOString() };
    services.sessionRepo.update(sessionId, (s) => ({ ...s, result }));
    return "Result recorded.";
  },
});
