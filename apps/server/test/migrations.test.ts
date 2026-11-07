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
    expect(tables).toEqual(expect.arrayContaining(["github_sync_state", "notices", "conflicts"]));
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
  it("are named in timestamp order with the GitHub and orchestration migrations both present", () => {
    expect(names).toEqual([...names].sort());
    expect(names.some((n) => n.endsWith("_github_sync"))).toBe(true);
    expect(names.some((n) => n.endsWith("_orchestration"))).toBe(true);
  });

  it("create the full schema on a fresh database", () => {
    expectFullSchema(join(tempDir(), "fresh.db"));
  });

  it.each([
    ["orchestration only", (n: string) => !n.endsWith("_github_sync")],
    ["GitHub sync only", (n: string) => !n.endsWith("_orchestration")],
  ])("upgrade a database that applied %s", (_label, keep) => {
    const file = join(tempDir(), "old.db");
    openDatabase(file, partialMigrations(keep)).close();
    expectFullSchema(file);
  });
});
