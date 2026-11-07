import { randomUUID } from "node:crypto";
import {
  type FactoryDigest,
  type FactoryItem,
  type FactoryItemStage,
  type FactoryLoop,
  FactoryTuning,
} from "@codeden/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../db/client";
import { factoryDigests, factoryItems, factoryLoops } from "../../db/schema-factory";
import type { EventStore } from "../../events/store";
import { localDay } from "./policy";

/** A new item: the identifying fields, plus anything else to set. */
export type NewFactoryItem = Pick<
  FactoryItem,
  "projectId" | "workKey" | "title" | "summary" | "source" | "stage"
> &
  Partial<Omit<FactoryItem, "id" | "createdAt" | "updatedAt">>;

/** Stages of items that are still moving through the loop. */
export const ACTIVE_STAGES: FactoryItemStage[] = ["building", "verifying", "watching"];
/** Stages of items waiting to be built or triaged. */
export const WAITING_STAGES: FactoryItemStage[] = ["candidate", "backlog"];
/** Final stages. */
export const DONE_STAGES: FactoryItemStage[] = [
  "merged",
  "reverted",
  "rejected",
  "failed",
  "escalated",
];

/**
 * Factory state (§10.1) over the event log: reads come from the `factory_*` projections,
 * writes append `factory.*` events (projected in the same transaction).
 */
export class FactoryStore {
  constructor(
    private readonly db: Db,
    private readonly events: EventStore,
  ) {}

  loop(projectId: string): FactoryLoop | undefined {
    return this.db.select().from(factoryLoops).where(eq(factoryLoops.projectId, projectId)).get()
      ?.loop;
  }

  /** The project's loop, or a fresh idle one (not saved). */
  loopOrNew(projectId: string, now = new Date()): FactoryLoop {
    return (
      this.loop(projectId) ?? {
        projectId,
        state: "idle",
        pausedReason: null,
        consecutiveFailures: 0,
        day: localDay(now),
        mergesToday: 0,
        discovery: [],
        nextArea: 0,
        lastDiscoveryAt: null,
        lastDigestDay: null,
        enabledAt: null,
        seenFailedShas: [],
        tuning: FactoryTuning.parse({}),
        lastTickAt: null,
        updatedAt: now.toISOString(),
      }
    );
  }

  saveLoop(loop: FactoryLoop): FactoryLoop {
    const next = { ...loop, updatedAt: new Date().toISOString() };
    this.events.append([
      { type: "factory.loop.updated", sessionId: null, payload: { loop: next } },
    ]);
    return next;
  }

  item(id: string): FactoryItem | undefined {
    return this.db.select().from(factoryItems).where(eq(factoryItems.id, id)).get()?.item;
  }

  items(projectId: string, stages?: FactoryItemStage[]): FactoryItem[] {
    const where = stages
      ? and(eq(factoryItems.projectId, projectId), inArray(factoryItems.stage, stages))
      : eq(factoryItems.projectId, projectId);
    return this.db
      .select()
      .from(factoryItems)
      .where(where)
      .orderBy(desc(factoryItems.updatedAt))
      .limit(500)
      .all()
      .map((r) => r.item);
  }

  /** The item a builder, reviewer or revert session works on. */
  itemForSession(projectId: string, sessionId: string): FactoryItem | undefined {
    return this.items(projectId, [...ACTIVE_STAGES, ...WAITING_STAGES]).find(
      (i) => i.builderSessionId === sessionId || i.reviewerSessionId === sessionId,
    );
  }

  /** Create an item; everything not given starts empty. */
  createItem(draft: NewFactoryItem): FactoryItem {
    const now = new Date().toISOString();
    const item: FactoryItem = {
      area: null,
      acceptanceCriteria: [],
      score: null,
      issue: null,
      pr: null,
      builderSessionId: null,
      builderProvider: null,
      reviewerSessionId: null,
      reviewerProvider: null,
      reviewerNote: null,
      review: null,
      checks: [],
      attempts: 0,
      reason: null,
      note: null,
      mergeSha: null,
      revertOf: null,
      triageRequestedAt: null,
      nudges: {},
      mergedAt: null,
      finishedAt: null,
      ...draft,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
    this.events.append([{ type: "factory.item.updated", sessionId: null, payload: { item } }]);
    return item;
  }

  /** Apply a change to an item; writes only when something changed. */
  updateItem(id: string, change: (item: FactoryItem) => FactoryItem): FactoryItem {
    const current = this.item(id);
    if (!current) throw new Error(`No factory item ${id}`);
    const changed = change(current);
    if (JSON.stringify(changed) === JSON.stringify(current)) return current;
    const next = { ...changed, updatedAt: new Date().toISOString() };
    this.events.append([
      { type: "factory.item.updated", sessionId: null, payload: { item: next } },
    ]);
    return next;
  }

  digests(projectId: string, limit = 10): FactoryDigest[] {
    return this.db
      .select()
      .from(factoryDigests)
      .where(eq(factoryDigests.projectId, projectId))
      .orderBy(desc(factoryDigests.createdAt))
      .limit(limit)
      .all()
      .map((r) => r.digest);
  }

  saveDigest(digest: FactoryDigest): void {
    this.events.append([{ type: "factory.digest.created", sessionId: null, payload: { digest } }]);
  }
}
