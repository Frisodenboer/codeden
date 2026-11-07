import { z } from "zod";
import { defineTool } from "../../define";
import { inGithubProject } from "../github/available";
import { githubProject } from "../shared/helpers";

/** `list_issues` (§8.3). */
export const listIssues = defineTool({
  name: "list_issues",
  description: "List this project's GitHub issues (open by default), optionally by label.",
  roles: ["pm"],
  scope: "project",
  isAvailable: inGithubProject,
  input: z.object({
    state: z.enum(["open", "closed", "all"]).optional(),
    labels: z.array(z.string()).optional(),
    limit: z.int().min(1).max(100).optional(),
  }),
  handler: async (query, { services, projectId }) => {
    const issues = await services.orchestration.github.listIssues(
      githubProject(services, projectId),
      query,
    );
    return { count: issues.length, issues };
  },
});

/** `get_issue` (§8.3). */
export const getIssue = defineTool({
  name: "get_issue",
  description: "One GitHub issue of this project with its body and comments.",
  roles: ["pm"],
  scope: "project",
  isAvailable: inGithubProject,
  input: z.object({ number: z.int().positive() }),
  handler: async ({ number }, { services, projectId }) =>
    services.orchestration.github.getIssue(githubProject(services, projectId), number),
});

/** `triage_issue` (§8.3, §10 issue triage): labels, comment, accept or decline. */
export const triageIssue = defineTool({
  name: "triage_issue",
  description:
    "Record a triage decision on an issue: ready, needs_info, unsafe, out_of_scope or duplicate, with labels to add or remove and an optional comment (close: true for out of scope or duplicates). Follow the project's policy; ask the user when unsure.",
  roles: ["pm"],
  scope: "project",
  isAvailable: inGithubProject,
  input: z.object({
    number: z.int().positive(),
    decision: z.enum(["ready", "needs_info", "unsafe", "out_of_scope", "duplicate"]),
    labels: z.array(z.string()).optional(),
    removeLabels: z.array(z.string()).optional(),
    comment: z.string().min(1).max(10_000).optional(),
    close: z.boolean().optional(),
  }),
  handler: async ({ number, ...triage }, { services, projectId }) =>
    services.orchestration.github.triageIssue(githubProject(services, projectId), number, triage),
});

/** `create_issue` (§8.3). */
export const createIssue = defineTool({
  name: "create_issue",
  description:
    "Create a GitHub issue in this project (for planned work: include a work key and acceptance criteria in the body).",
  roles: ["pm"],
  scope: "project",
  isAvailable: inGithubProject,
  input: z.object({
    title: z.string().trim().min(1).max(256),
    body: z.string().max(60_000),
    labels: z.array(z.string()).optional(),
  }),
  handler: async (issue, { services, projectId }) =>
    services.orchestration.github.createIssue(githubProject(services, projectId), issue),
});
