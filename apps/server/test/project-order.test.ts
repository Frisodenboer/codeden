import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEnvelope } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../src/db/client";
import { events } from "../src/db/schema";
import { applyProjection } from "../src/events/projector";
import { EventStore } from "../src/events/store";
import { runTool } from "../src/services/exec";
import { ProjectService } from "../src/services/projects/project-service";

let dir: string;
const opened: Database[] = [];
let database: Database;
let store: EventStore;
let service: ProjectService;

function serviceFor(db: Database): ProjectService {
  return new ProjectService({
    db: db.db,
    store: new EventStore(db.db),
    exec: runTool,
    projectsDir: join(dir, "clones"),
  });
}

function open(name: string): Database {
  const db = openDatabase(join(dir, name));
  opened.push(db);
  return db;
}

async function add(name: string): Promise<string> {
  const path = join(dir, "work", name);
  mkdirSync(path, { recursive: true });
  return (await service.create({ source: { type: "local", path } })).project.id;
}

const ids = (s = service) => s.list().map((p) => p.id);

/** Replay the whole log of `from` into an empty database through the projector. */
function rebuild(from: Database): Database {
  const to = open("rebuilt.db");
  const log = new EventStore(from.db).listAfter(0, 10_000);
  to.db.transaction((tx) => {
    for (const raw of log) applyProjection(tx, EventEnvelope.parse(raw));
  });
  return to;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeden-project-order-"));
  database = open("codeden.db");
  store = new EventStore(database.db);
  service = serviceFor(database);
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("project order", () => {
  it("lists pinned projects first, then the manual order, and adds new projects last", async () => {
    const zeta = await add("zeta");
    const alpha = await add("alpha");
    const mid = await add("mid");
    // New projects go to the end, so the list starts in creation order.
    expect(ids()).toEqual([zeta, alpha, mid]);

    expect(service.update(mid, { pinned: true })).toMatchObject({ pinned: true, sortOrder: 2 });
    expect(ids()).toEqual([mid, zeta, alpha]);

    const late = await add("late");
    expect(ids()).toEqual([mid, zeta, alpha, late]);

    // Unpinning keeps the slot, so the project returns to its place among the rest.
    service.update(mid, { pinned: false });
    expect(ids()).toEqual([zeta, alpha, mid, late]);
  });

  it("reorders with one event, and archived projects keep their slot", async () => {
    const a = await add("a");
    const b = await add("b");
    const c = await add("c");
    service.update(c, { pinned: true });
    const before = store.headSeq();

    expect(service.reorder([c, b, a]).map((p) => p.id)).toEqual([c, b, a]);
    const log = store.listAfter(before);
    expect(log.map((e) => e.type)).toEqual(["projects.reordered"]);
    expect(log[0]?.payload).toEqual({ projectIds: [c, b, a] });
    expect(service.list().map((p) => p.sortOrder)).toEqual([0, 1, 2]);

    // Pinned projects list first whatever the order says; each group keeps its own order.
    service.reorder([b, c, a]);
    expect(ids()).toEqual([c, b, a]);

    service.archive(b);
    expect(() => service.reorder([c, b, a])).toThrow(/exactly once/);
    service.reorder([a, c]);
    expect(ids()).toEqual([c, a]);
    expect(service.get(b).sortOrder).toBe(0);
    // Restoring brings it back with its old slot; `a` now shares slot 0, so the name decides.
    await service.create({ source: { type: "local", path: join(dir, "work", "b") } });
    expect(service.get(b)).toMatchObject({ archivedAt: null, sortOrder: 0 });
    expect(ids()).toEqual([c, a, b]);
  });

  it("rejects an order that does not list every active project exactly once", async () => {
    const a = await add("a");
    const b = await add("b");
    const before = store.headSeq();
    for (const [order, detail] of [
      [[a], `missing: ${b}`],
      [[a, b, a], `listed more than once: ${a}`],
      [[a, b, "ghost"], "not active projects: ghost"],
      [[], `missing: ${a}, ${b}`],
    ] as const) {
      let error: unknown;
      try {
        service.reorder([...order]);
      } catch (e) {
        error = e;
      }
      expect(error).toMatchObject({ status: 400, code: "invalid_order" });
      expect((error as Error).message).toContain(detail);
    }
    expect(store.headSeq()).toBe(before);
    expect(ids()).toEqual([a, b]);
  });

  it("rebuilds the same projection from the log, including events from before ordering", async () => {
    // A `project.created` written by an older build: no `pinned`, no `sortOrder`.
    const ts = "2026-11-01T10:00:00.000Z";
    const legacy = {
      id: "legacy",
      kind: "local",
      name: "legacy",
      slug: "legacy",
      path: join(dir, "legacy"),
      defaultBranch: null,
      defaultProvider: null,
      autonomy: null,
      timezone: null,
      createdAt: ts,
      updatedAt: ts,
      archivedAt: null,
    };
    database.db.transaction((tx) => {
      const payload = { project: legacy };
      const type = "project.created";
      const row = tx
        .insert(events)
        .values({ sessionId: null, type, payload, ts })
        .returning({ seq: events.seq })
        .get();
      applyProjection(
        tx,
        EventEnvelope.parse({ seq: row.seq, sessionId: null, type, payload, ts }),
      );
    });
    expect(service.get("legacy")).toMatchObject({ pinned: false, sortOrder: 0 });

    const x = await add("x");
    const y = await add("y");
    expect(ids()).toEqual(["legacy", x, y]);
    service.update(y, { pinned: true });
    service.reorder([y, x, "legacy"]);
    service.archive(x);

    const rebuilt = serviceFor(rebuild(database));
    expect(rebuilt.list({ includeArchived: true })).toEqual(
      service.list({ includeArchived: true }),
    );
    expect(ids(rebuilt)).toEqual([y, "legacy"]);
  });
});
