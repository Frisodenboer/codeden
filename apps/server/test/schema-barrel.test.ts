import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const dbDir = join(import.meta.dirname, "../src/db");

describe("schema barrel", () => {
  it("re-exports every schema-*.ts file that drizzle-kit reads", () => {
    const files = readdirSync(dbDir)
      .filter((n) => /^schema-.+\.ts$/.test(n))
      .map((n) => n.replace(/\.ts$/, ""));
    const barrel = readFileSync(join(dbDir, "schema.ts"), "utf8");
    const exported = [...barrel.matchAll(/export \* from "\.\/(schema-[^"]+)";/g)].map((m) => m[1]);
    expect(files.length).toBeGreaterThan(1);
    expect(exported.sort()).toEqual(files.sort());
  });
});
