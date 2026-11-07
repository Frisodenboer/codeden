import { z } from "zod";
import { defineTool, ToolError } from "../../define";

/** `comment_on_issue` (§8.3): a comment on an issue or a PR conversation. */
export const commentOnIssueTool = defineTool({
  name: "comment_on_issue",
  description:
    "Post a Markdown comment on a GitHub issue or pull request in your project. `number` defaults to your session's issue, then its PR. Keep it short and factual; use attach_evidence for screenshots and test output.",
  roles: ["agent", "pm"],
  scope: "project",
  input: z.object({
    number: z.int().positive().optional().describe("Issue or PR number"),
    body: z.string().min(1).max(60_000),
  }),
  handler: async (input, { services, projectId, sessionId }) => {
    const session = sessionId ? services.sessionRepo.find(sessionId)?.session : undefined;
    const number = input.number ?? session?.issue?.number ?? session?.pr?.number;
    if (!number) throw new ToolError("Pass the issue or PR number");
    const footer =
      session && session.role === "agent" ? `\n\n<sub>CodeDen session \`${session.id}\`</sub>` : "";
    const comment = await services.github.commentOnIssue(
      projectId,
      number,
      `${input.body}${footer}`,
    );
    return `Commented on #${number}: ${comment.url}`;
  },
});
