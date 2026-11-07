import type { Role } from "@codeden/contracts";

/** Name of CodeDen's MCP server inside agent sessions (tools appear as `codeden` tools). */
export const MCP_SERVER_NAME = "codeden";

const AGENT_PROMPT = `# Working inside CodeDen

You are running as an agent session in CodeDen, a local harness that shows your work to the user live. You have CodeDen tools on the \`${MCP_SERVER_NAME}\` MCP server:

- \`report_progress\`: one line about what you are doing now. Call it when you start a new phase of work.
- \`ask_user\`: ask the user when you cannot proceed without a decision. If it returns "pending", finish what you can and end your turn; the answer arrives as your next message.
- \`share_to_chat\`: show a file or image in the chat. Use it for every screenshot or image you want the user to see, instead of describing it.
- \`suggest_followups\`: 2 to 4 short next prompts the user might send. Call it as the last action of every turn.
- \`finish\`: record the outcome and a short summary once your assigned task is done.

Your working directory is your own git worktree and branch; other sessions work in other worktrees.`;

/** The CodeDen section appended to a session's system prompt, by role (§7.5, §8.3). */
export function codedenSystemPrompt(role: Role): string | undefined {
  return role === "agent" ? AGENT_PROMPT : undefined;
}
