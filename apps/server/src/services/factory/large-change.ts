import type { FactoryAllowLargeChangeRequest, FactoryItem } from "@codeden/contracts";
import { conflict, notFound } from "../errors";
import type { FactoryContext } from "./context";
import { recordDecision } from "./unattended";

/**
 * Work that can't be split under the size limit (an initial scaffold, a stack migration). The
 * PM allows it at triage or, after the size check failed, with `factory_allow_large_change`.
 * Either way it is recorded as a factory decision, so the user sees it in the inbox and the
 * digest. Every other merge check still applies.
 */

/** Record the PM's allowance for `item` as a factory decision. */
export function recordLargeChange(ctx: FactoryContext, item: FactoryItem, reason: string): void {
  recordDecision(
    ctx,
    { projectId: item.projectId, sessionId: null },
    {
      question: `"${item.title}" is bigger than the factory's size limit. Split it, or build and merge it as one change?`,
      decision: "Build and merge it as one change",
      reasoning: reason,
    },
  );
}

/** `factory_allow_large_change`: let an item that failed on size go ahead after all. */
export function allowLargeChange(
  ctx: FactoryContext,
  projectId: string,
  req: FactoryAllowLargeChangeRequest,
): FactoryItem {
  const item = ctx.store.item(req.itemId);
  if (!item || item.projectId !== projectId) {
    throw notFound(`No factory item ${req.itemId}`, "item_not_found");
  }
  if (item.stage !== "failed" && item.stage !== "verifying") {
    throw conflict(
      `Item ${item.id} is ${item.stage}; only an item whose pull request is being verified, or failed its checks, can be allowed`,
      "not_verifiable",
    );
  }
  if (item.pr?.state !== "open") {
    throw conflict(`Item ${item.id} has no open pull request`, "no_open_pr");
  }
  // A failed item comes back only if size is what stopped it; any other failure it had then
  // goes through the usual fix rounds.
  const sizeFailed = item.checks.some((c) => c.name === "size" && c.state === "fail");
  if (item.stage === "failed" && !sizeFailed) {
    throw conflict(`Item ${item.id} didn't fail on size: ${item.reason ?? ""}`, "not_size");
  }
  recordLargeChange(ctx, item, req.reason);
  return ctx.store.updateItem(item.id, (i) => ({
    ...i,
    largeChange: req.reason,
    stage: "verifying",
    reason: null,
    finishedAt: null,
    note: "Allowed over the size limit by the PM; checking again",
  }));
}
