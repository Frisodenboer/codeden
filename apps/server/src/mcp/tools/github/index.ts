import type { AnyServerTool } from "../../define";
import { attachEvidenceTool } from "./attach-evidence";
import { commentOnIssueTool } from "./comment-on-issue";
import { createPullRequestTool } from "./create-pull-request";
import { getPrStatusTool } from "./get-pr-status";

/** GitHub tools (§8.3, §9), backed by `GithubService`. */
export const githubTools: AnyServerTool[] = [
  createPullRequestTool,
  attachEvidenceTool,
  commentOnIssueTool,
  getPrStatusTool,
];
