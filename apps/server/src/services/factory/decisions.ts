import type {
  DiscoveryArea,
  FactoryCandidate,
  FactoryItem,
  FactoryTriageRequest,
  ReviewVerdict,
  Session,
} from "@codeden/contracts";
import { DiscoveryArea as DiscoveryAreaSchema } from "@codeden/contracts";
import { badRequest, conflict, errorMessage, notFound } from "../errors";
import type { FactoryContext } from "./context";
import { candidateWorkKey, FACTORY_LABEL } from "./loop";
import { slugify } from "./policy";

/**
 * The judgement inputs of the loop (§10.1): candidates from improvement finders, the PM's
 * triage decisions, and the reviewer's verdict. Each records data the state machine acts on.
 */

/** `factory_report_candidates`: an improvement finder reports what it found. */
export function reportCandidates(
  ctx: FactoryContext,
  session: Session,
  candidates: FactoryCandidate[],
): { created: Array<{ itemId: string; title: string }>; skipped: string[] } {
  const prefix = "factory:discover:";
  if (!session.projectId || !session.workKey.startsWith(prefix)) {
    throw badRequest("Only factory improvement finders can report candidates", "not_a_finder");
  }
  const parsedArea = DiscoveryAreaSchema.safeParse(session.workKey.slice(prefix.length));
  const area: DiscoveryArea | null = parsedArea.success ? parsedArea.data : null;
  const existing = new Set(ctx.store.items(session.projectId).map((i) => slugify(i.title)));
  const created: Array<{ itemId: string; title: string }> = [];
  const skipped: string[] = [];
  for (const c of candidates) {
    const slug = slugify(c.title);
    if (existing.has(slug)) {
      skipped.push(c.title);
      continue;
    }
    existing.add(slug);
    const summary = c.paths?.length
      ? `${c.summary}\n\nLikely paths: ${c.paths.join(", ")}`
      : c.summary;
    const item = ctx.store.createItem({
      projectId: session.projectId,
      workKey: candidateWorkKey(c.title),
      title: c.title,
      summary,
      source: "discovery",
      area,
      acceptanceCriteria: c.acceptanceCriteria,
      stage: "candidate",
    });
    created.push({ itemId: item.id, title: item.title });
  }
  return { created, skipped };
}

function issueBody(item: FactoryItem, criteria: string[]): string {
  return [
    item.summary,
    "",
    "## Acceptance criteria",
    ...criteria.map((c) => `- [ ] ${c}`),
    "",
    `_Accepted by the CodeDen factory (${item.source}${item.area ? `, ${item.area}` : ""}). It will be built and merged automatically once every merge check passes._`,
    `<!-- codeden:factory item=${item.id} -->`,
  ].join("\n");
}

/** `factory_triage` / `POST .../factory/items/:id/triage`: the PM accepts or rejects a candidate. */
export async function triage(
  ctx: FactoryContext,
  projectId: string,
  req: FactoryTriageRequest,
): Promise<FactoryItem> {
  const item = ctx.store.item(req.itemId);
  if (!item || item.projectId !== projectId)
    throw notFound(`No factory item ${req.itemId}`, "item_not_found");
  if (item.stage !== "candidate") {
    throw conflict(`Item ${item.id} is already ${item.stage}`, "not_a_candidate");
  }
  const at = ctx.now().toISOString();
  if (req.decision === "reject") {
    if (!req.reason) throw badRequest("A reason is required to reject", "reason_required");
    const rejected = ctx.store.updateItem(item.id, (i) => ({
      ...i,
      stage: "rejected",
      reason: req.reason ?? null,
      score: req.score ?? i.score,
      finishedAt: at,
    }));
    if (item.issue) {
      await ctx.github
        .comment(
          projectId,
          item.issue.number,
          `The CodeDen factory is not taking this on: ${req.reason}`,
        )
        .catch((error: unknown) => ctx.log?.(`factory: comment: ${errorMessage(error)}`));
    }
    return rejected;
  }
  const criteria = req.acceptanceCriteria ?? item.acceptanceCriteria;
  if (criteria.length === 0) {
    throw badRequest("Acceptance criteria are required to accept", "criteria_required");
  }
  let issue = item.issue;
  if (issue) {
    await ctx.github.labelIssue(projectId, issue.number, [FACTORY_LABEL]).catch(() => undefined);
    await ctx.github
      .comment(
        projectId,
        issue.number,
        `Accepted by the CodeDen factory. Acceptance criteria:\n${criteria.map((c) => `- [ ] ${c}`).join("\n")}`,
      )
      .catch((error: unknown) => ctx.log?.(`factory: comment: ${errorMessage(error)}`));
  } else {
    issue = await ctx.github.createIssue(projectId, {
      title: item.title,
      body: issueBody(item, criteria),
      labels: [FACTORY_LABEL],
    });
  }
  const accepted = issue;
  return ctx.store.updateItem(item.id, (i) => ({
    ...i,
    stage: "backlog",
    score: req.score ?? i.score,
    acceptanceCriteria: criteria,
    issue: accepted,
    workKey: `issue:${accepted.number}`,
    note: null,
  }));
}

/** `factory_submit_review`: the independent reviewer's structured verdict. */
export function submitReview(
  ctx: FactoryContext,
  session: Session,
  verdict: ReviewVerdict,
): { recorded: boolean; message: string } {
  const item = session.projectId
    ? ctx.store.items(session.projectId).find((i) => i.reviewerSessionId === session.id)
    : undefined;
  if (!item) throw badRequest("You are not reviewing a factory pull request", "not_a_reviewer");
  if (item.stage !== "verifying") {
    return {
      recorded: false,
      message: `Not recorded: the item is ${item.stage}${item.stage === "building" ? " (the author is fixing it; you will be asked to review again)" : ""}.`,
    };
  }
  ctx.store.updateItem(item.id, (i) => {
    const { rereview_sent: _s, reviewer: _r, ...nudges } = i.nudges;
    return { ...i, review: verdict, nudges };
  });
  return { recorded: true, message: `Verdict recorded: ${verdict.verdict}.` };
}
