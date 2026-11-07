import {
  type FactoryItem,
  type FactoryMergeChecks,
  type FactoryStatus,
  type FactoryWorkItem,
  isFactoryMode,
} from "@codeden/contracts";
import { budgetSpend, type FactoryContext, visionOf } from "./context";
import { localDay } from "./policy";
import { ACTIVE_STAGES, DONE_STAGES, WAITING_STAGES } from "./store";

function workItem(i: FactoryItem): FactoryWorkItem {
  return {
    id: i.id,
    title: i.title,
    workKey: i.workKey,
    issue: i.issue,
    pr: i.pr,
    score: i.score,
    sessionId: i.builderSessionId,
    stage: i.stage,
    source: i.source,
    reason: i.reason,
    note: i.note,
    updatedAt: i.updatedAt,
  };
}

function mergeChecks(i: FactoryItem): FactoryMergeChecks | null {
  if (!i.pr || i.checks.length === 0) return null;
  return {
    itemId: i.id,
    prNumber: i.pr.number,
    title: i.title,
    checks: i.checks,
    reviewerProvider: i.reviewerProvider,
    reviewerNote: i.reviewerNote,
    verdict: i.review?.verdict ?? null,
  };
}

/** `GET /api/projects/:id/factory`: everything the factory panel shows (§10.1 visibility). */
export function buildStatus(ctx: FactoryContext, projectId: string): FactoryStatus {
  const project = ctx.projects.get(projectId);
  const loop = ctx.store.loopOrNew(projectId, ctx.now());
  const all = ctx.store.items(projectId);
  const waiting = all
    .filter((i) => WAITING_STAGES.includes(i.stage))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  const active = all.filter((i) => ACTIVE_STAGES.includes(i.stage));
  const done = all.filter((i) => DONE_STAGES.includes(i.stage)).slice(0, 30);
  const spend = budgetSpend(ctx, projectId, localDay(ctx.now()), project.factoryLimits);
  const globalKill = ctx.settings.get().factory.killSwitch;
  return {
    projectId,
    mode: project.autonomyMode,
    experimental: isFactoryMode(project.autonomyMode),
    loopState: project.killSwitch || globalKill ? "stopped" : loop.state,
    pausedReason: loop.pausedReason,
    killSwitch: project.killSwitch,
    globalKillSwitch: globalKill,
    limits: project.factoryLimits,
    tuning: loop.tuning,
    spendToday: { usd: Math.round(spend.usd * 10_000) / 10_000, tokens: spend.tokens },
    mergesToday: loop.day === localDay(ctx.now()) ? loop.mergesToday : 0,
    consecutiveFailures: loop.consecutiveFailures,
    activeSessions: ctx.sessions.activeCount(projectId),
    backlog: waiting.map(workItem),
    inProgress: active.map(workItem),
    mergeChecks: [...active, ...done].flatMap((i) => mergeChecks(i) ?? []).slice(0, 20),
    recent: done.map(workItem),
    visionExists: visionOf(project).exists,
    lastDigest: ctx.store.digests(projectId, 1)[0] ?? null,
    lastTickAt: loop.lastTickAt,
  };
}
