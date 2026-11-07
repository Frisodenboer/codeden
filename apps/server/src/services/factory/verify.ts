import {
  type FactoryItem,
  type FactoryLoop,
  isFactoryMode,
  type Project,
} from "@codeden/contracts";
import { errorMessage } from "../errors";
import { evaluateChecks, failedChecks, sameChecks } from "./checks";
import { type FactoryContext, factoryNotice, visionOf } from "./context";
import type { FactoryPr } from "./github-port";
import { escalate, failItem, runAudit } from "./outcomes";
import { isUiFile, mayMerge, pickReviewer } from "./policy";
import { fixPrompt, REVIEWER_NUDGE, reReviewPrompt } from "./prompts";

const ENDED = new Set(["idle", "interrupted", "completed", "failed", "stopped"]);

/** Audit results per item and head commit (re-run after a restart is fine). */
const auditCache = new Map<string, { ok: boolean; detail: string }>();

/**
 * One verification step for an item with a PR (§10.1 step 4-5): gather the inputs, record the
 * merge checks, start or nudge the independent reviewer, then merge, start a fix round, fail
 * or escalate. Returns the (possibly changed) loop.
 */
export async function advanceVerifying(
  ctx: FactoryContext,
  project: Project,
  loop: FactoryLoop,
  item: FactoryItem,
): Promise<FactoryLoop> {
  if (!item.pr) return failItem(ctx, loop, item, "The item has no pull request");
  let pr: FactoryPr;
  try {
    pr = await ctx.github.prDetails(project.id, item.pr.number);
  } catch (error) {
    ctx.store.updateItem(item.id, (i) => ({
      ...i,
      note: `Could not read the PR: ${errorMessage(error)}`,
    }));
    return loop;
  }
  if (pr.ref.state === "merged") {
    ctx.store.updateItem(item.id, (i) => ({
      ...i,
      pr: pr.ref,
      stage: "merged",
      note: "Merged outside the factory",
      mergedAt: i.mergedAt ?? ctx.now().toISOString(),
      finishedAt: ctx.now().toISOString(),
    }));
    return loop;
  }
  if (pr.ref.state === "closed") return failItem(ctx, loop, item, "The pull request was closed");

  const vision = visionOf(project);
  const now = ctx.now();
  const builder = item.builderSessionId ? ctx.repo.find(item.builderSessionId)?.session : undefined;
  const worktree = builder?.worktreePath ?? null;
  const auditConfigured = Boolean(loop.tuning.auditCommand && worktree);
  const auditKey = `${item.id}:${pr.headSha ?? ""}`;
  if (auditConfigured && worktree && loop.tuning.auditCommand && !auditCache.has(auditKey)) {
    auditCache.set(auditKey, await runAudit(ctx, loop.tuning.auditCommand, worktree));
  }
  const evidence = pr.files.some(isUiFile)
    ? await ctx.github
        .hasScreenshotEvidence(project.id, pr.ref.number, item.issue?.number ?? null)
        .catch(() => false)
    : null;
  const since = Date.parse(item.nudges.verifying ?? item.updatedAt);
  const { checks, outcome } = evaluateChecks({
    pr,
    issueTitle: item.issue?.title ?? item.title,
    review: item.review,
    reviewer: item.reviewerProvider,
    evidence,
    audit: auditCache.get(auditKey) ?? null,
    auditConfigured,
    ciGraceOver: now.getTime() - since > ctx.ciGraceMs,
    limits: project.factoryLimits,
    tuning: loop.tuning,
    areas: vision.parsed.protectedAreas,
    now: now.toISOString(),
  });
  let current = ctx.store.updateItem(item.id, (i) => ({
    ...i,
    pr: pr.ref,
    checks: sameChecks(i.checks, checks) ? i.checks : checks,
  }));

  if (outcome === "escalate") return escalate(ctx, loop, current, checks);
  if (outcome === "fail") return handleFailure(ctx, project, loop, current);
  if (outcome === "pending") {
    current = await ensureReviewer(ctx, current, vision.text);
    return reviewerStalled(ctx, project, loop, current);
  }

  // Every check passed: merge, within the limits.
  if (loop.state === "paused" && current.source !== "revert") {
    ctx.store.updateItem(current.id, (i) => ({
      ...i,
      note: "Checks passed; waiting while the loop is paused",
    }));
    return loop;
  }
  if (!isFactoryMode(project.autonomyMode)) {
    ctx.store.updateItem(current.id, (i) => ({
      ...i,
      note: "Checks passed; this mode does not merge automatically",
    }));
    return loop;
  }
  if (!mayMerge(loop.mergesToday, project.factoryLimits)) {
    ctx.store.updateItem(current.id, (i) => ({
      ...i,
      note: "Checks passed; the daily merge limit is reached",
    }));
    return loop;
  }
  const title = `${current.title} (#${pr.ref.number})`;
  const res = await ctx.github
    .merge(project.id, pr.ref.number, { sha: pr.headSha, title })
    .catch((error: unknown) => ({ merged: false, sha: null, error: errorMessage(error) }));
  if (!res.merged) {
    const why = "error" in res ? res.error : "GitHub did not merge it";
    ctx.store.updateItem(current.id, (i) => ({ ...i, note: `Merge failed: ${why}` }));
    return loop;
  }
  const at = ctx.now().toISOString();
  ctx.store.updateItem(current.id, (i) => ({
    ...i,
    stage: "watching",
    pr: { ...pr.ref, state: "merged" },
    mergeSha: res.sha,
    mergedAt: at,
    note: "Merged; watching CI on the default branch",
  }));
  if (current.issue && current.source !== "revert") {
    const passed = checks
      .filter((c) => c.state === "pass")
      .map((c) => c.name)
      .join(", ");
    await ctx.github
      .comment(
        project.id,
        current.issue.number,
        `Merged automatically by the CodeDen factory in #${pr.ref.number} after every merge check passed (${passed}).`,
      )
      .catch((error: unknown) => ctx.log?.(`factory: comment: ${errorMessage(error)}`));
  }
  factoryNotice(ctx, {
    id: `factory.merged:${current.id}`,
    projectId: project.id,
    target: "pm",
    event: "merged",
    title: `Factory merged #${pr.ref.number}: ${current.title}`,
    text: `Merged ${pr.ref.url} (${res.sha ?? "unknown sha"}); watching CI on the default branch.`,
    itemIds: [current.id],
    wake: false,
  });
  return { ...loop, mergesToday: loop.mergesToday + 1, consecutiveFailures: 0 };
}

/** Start the independent reviewer (another provider when possible), or ask it to look again. */
async function ensureReviewer(
  ctx: FactoryContext,
  item: FactoryItem,
  vision: string,
): Promise<FactoryItem> {
  if (item.review) return item;
  if (item.reviewerSessionId) {
    if (!item.nudges.rereview_pending) return item;
    await ctx.sessions.message(item.reviewerSessionId, reReviewPrompt(item));
    return ctx.store.updateItem(item.id, (i) => {
      const { rereview_pending: _p, ...rest } = i.nudges;
      return { ...i, nudges: { ...rest, rereview_sent: ctx.now().toISOString() } };
    });
  }
  const project = ctx.projects.get(item.projectId);
  if (ctx.sessions.activeCount(item.projectId) >= project.factoryLimits.maxConcurrentSessions) {
    return ctx.store.updateItem(item.id, (i) => ({
      ...i,
      note: "Waiting for a session slot for the review",
    }));
  }
  const choice = pickReviewer(item.builderProvider, ctx.sessions.providers());
  const res = await ctx.sessions.startReviewer(item, vision, choice.provider, choice.note);
  if (res.status !== "started") {
    return ctx.store.updateItem(item.id, (i) => ({
      ...i,
      note: `Review not started (${res.status})`,
    }));
  }
  return ctx.store.updateItem(item.id, (i) => ({
    ...i,
    reviewerSessionId: res.sessionId,
    reviewerProvider: choice.provider,
    reviewerNote: choice.note,
    note: null,
  }));
}

/** While checks are pending: nudge a reviewer that ended its turn without a verdict. */
async function reviewerStalled(
  ctx: FactoryContext,
  project: Project,
  loop: FactoryLoop,
  item: FactoryItem,
): Promise<FactoryLoop> {
  if (item.review || !item.reviewerSessionId || item.nudges.rereview_pending) return loop;
  const s = ctx.repo.find(item.reviewerSessionId)?.session;
  if (!s || !ENDED.has(s.status)) return loop;
  if (s.status === "failed" || s.status === "stopped") {
    if (item.nudges.reviewer_restarted)
      return failReview(ctx, project, loop, item, `The reviewer session ${s.status}`);
    ctx.store.updateItem(item.id, (i) => ({
      ...i,
      reviewerSessionId: null,
      nudges: { ...i.nudges, reviewer_restarted: ctx.now().toISOString() },
    }));
    return loop;
  }
  const nudged = item.nudges.reviewer;
  if (!nudged) {
    const at = ctx.now().toISOString();
    ctx.store.updateItem(item.id, (i) => ({ ...i, nudges: { ...i.nudges, reviewer: at } }));
    await ctx.sessions.message(s.id, REVIEWER_NUDGE);
    return loop;
  }
  if (Date.parse(s.updatedAt) > Date.parse(nudged)) {
    return failReview(ctx, project, loop, item, "The reviewer ended without a verdict");
  }
  return loop;
}

function failReview(
  ctx: FactoryContext,
  project: Project,
  loop: FactoryLoop,
  item: FactoryItem,
  reason: string,
): Promise<FactoryLoop> {
  const at = ctx.now().toISOString();
  const current = ctx.store.updateItem(item.id, (i) => ({
    ...i,
    checks: i.checks.map((c) =>
      c.name === "review" ? { ...c, state: "fail" as const, detail: reason, at } : c,
    ),
  }));
  return handleFailure(ctx, project, loop, current);
}

/** Failed checks: one more fix round if allowed, otherwise the item fails (and may pause). */
async function handleFailure(
  ctx: FactoryContext,
  project: Project,
  loop: FactoryLoop,
  item: FactoryItem,
): Promise<FactoryLoop> {
  const failed = failedChecks(item.checks);
  const builder = item.builderSessionId ? ctx.repo.find(item.builderSessionId)?.session : undefined;
  const fixable =
    item.attempts < loop.tuning.maxFixAttempts &&
    builder !== undefined &&
    builder.status !== "failed" &&
    builder.status !== "stopped" &&
    item.review?.verdict !== "reject";
  if (fixable && builder) {
    const at = ctx.now().toISOString();
    ctx.store.updateItem(item.id, (i) => ({
      ...i,
      stage: "building",
      attempts: i.attempts + 1,
      review: null,
      note: `Fix round ${i.attempts + 1}: ${failed.map((c) => c.name).join(", ")}`,
      nudges: {
        ...i.nudges,
        [`fix_${i.attempts + 1}`]: at,
        ...(i.reviewerSessionId ? { rereview_pending: at } : {}),
      },
    }));
    await ctx.sessions.message(builder.id, fixPrompt(item, failed));
    return loop;
  }
  const reason =
    failed.map((c) => `${c.name}: ${c.detail ?? "failed"}`).join("; ") || "Merge checks failed";
  const next = failItem(ctx, loop, item, reason);
  if (item.pr) {
    await ctx.github
      .comment(
        project.id,
        item.pr.number,
        `The CodeDen factory's merge checks failed, so this PR is left for a human:\n\n${failed.map((c) => `- **${c.name}**: ${c.detail ?? "failed"}`).join("\n")}`,
      )
      .catch((error: unknown) => ctx.log?.(`factory: comment: ${errorMessage(error)}`));
  }
  return next;
}
