import type { FactoryDigest, FactoryItem, FactoryLoop } from "@codeden/contracts";
import { index, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Factory loop projections (§10.1), written in the same transaction as their events
 * (`factory.loop.updated`, `factory.item.updated`, `factory.digest.created`), so the loop can be
 * rebuilt from the log and resumed after a restart. Mode, limits and the project kill switch
 * live on the project row.
 */

const json = <T>(name: string) => text(name, { mode: "json" }).$type<T>();

export const factoryLoops = sqliteTable("factory_loops", {
  projectId: text("project_id").primaryKey(),
  state: text("state").notNull(),
  loop: json<FactoryLoop>("loop").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const factoryItems = sqliteTable(
  "factory_items",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    stage: text("stage").notNull(),
    workKey: text("work_key").notNull(),
    item: json<FactoryItem>("item").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("factory_items_project_stage").on(t.projectId, t.stage),
    index("factory_items_updated").on(t.projectId, t.updatedAt),
  ],
);

export const factoryDigests = sqliteTable(
  "factory_digests",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id").notNull(),
    day: text("day").notNull(),
    digest: json<FactoryDigest>("digest").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("factory_digests_project").on(t.projectId, t.createdAt)],
);
