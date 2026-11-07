import { cpSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findMigrationsDir, openDatabase } from "../src/db/client";

const all = findMigrationsDir();
const names = readdirSync(all).filter((n) => /^\d{14}_/.test(n));
const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "codeden-migrations-"));
  temps.push(dir);
  return dir;
}

/** A migrations folder with only some of the migrations, to stand in for an older build. */
function partialMigrations(keep: (name: string) => boolean): string {
  const dir = tempDir();
  for (const name of names.filter(keep))
    cpSync(join(all, name), join(dir, name), { recursive: true });
  return dir;
}

function columns(client: ReturnType<typeof openDatabase>["client"], table: string): string[] {
  return (client.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(
    (c) => c.name,
  );
}

function expectFullSchema(file: string): void {
  const database = openDatabase(file, all);
  try {
    const tables = (
      database.client.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
        name: string;
      }[]
    ).map((t) => t.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "github_sync_state",
        "notices",
        "conflicts",
        "usage_ledger",
        "rate_limit_windows",
        "factory_loops",
        "factory_items",
        "factory_digests",
      ]),
    );
    expect(columns(database.client, "github_prs")).toEqual(
      expect.arrayContaining(["review_decision", "linked_issues", "merged_at"]),
    );
    const applied = (
      database.client.prepare("SELECT name FROM __drizzle_migrations").all() as { name: string }[]
    ).map((m) => m.name);
    expect(applied.sort()).toEqual([...names].sort());
  } finally {
    database.close();
  }
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("migrations", () => {
  it("chain in timestamp order: GitHub sync, orchestration, usage ledger, factory loop", () => {
    expect(names).toEqual([...names].sort());
    const at = (suffix: string) => names.findIndex((n) => n.endsWith(suffix));
    expect(at("_github_sync")).toBeGreaterThan(-1);
    expect(at("_orchestration")).toBeGreaterThan(at("_github_sync"));
    expect(at("_usage_ledger")).toBeGreaterThan(at("_orchestration"));
    expect(at("_factory_loop")).toBeGreaterThan(at("_usage_ledger"));
  });

  it("create the full schema on a fresh database", () => {
    expectFullSchema(join(tempDir(), "fresh.db"));
  });

  it.each([
    ["orchestration only", (n: string) => !/_(github_sync|usage_ledger)$/.test(n)],
    ["GitHub sync only", (n: string) => !/_(orchestration|usage_ledger)$/.test(n)],
    ["usage ledger only", (n: string) => !/_(github_sync|orchestration)$/.test(n)],
    ["everything before the usage ledger", (n: string) => !/_(usage_ledger|factory_loop)$/.test(n)],
    ["everything before the factory loop", (n: string) => !n.endsWith("_factory_loop")],
  ])("upgrade a database that applied %s", (_label, keep) => {
    const file = join(tempDir(), "old.db");
    openDatabase(file, partialMigrations(keep)).close();
    expectFullSchema(file);
  });
});
