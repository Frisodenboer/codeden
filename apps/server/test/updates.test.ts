import { describe, expect, it } from "vitest";
import { UpdateService } from "../src/services/updates";

const registry = (version: string | null, status = 200) => {
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(String(url));
    if (version === null) throw new Error("getaddrinfo ENOTFOUND registry.npmjs.org");
    return new Response(JSON.stringify({ name: "codeden", version }), { status });
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
};

describe("update check (§16)", () => {
  it("reports a newer version once a day, refreshing on request", async () => {
    let now = Date.parse("2026-11-07T10:00:00Z");
    const r = registry("0.2.0");
    const s = new UpdateService({
      enabled: () => true,
      fetch: r.fetch,
      current: "0.1.0",
      now: () => now,
    });
    expect(await s.status()).toMatchObject({
      current: "0.1.0",
      latest: "0.2.0",
      updateAvailable: true,
      enabled: true,
      error: null,
      command: "npm i -g codeden@latest",
    });
    await s.status();
    expect(r.calls).toEqual(["https://registry.npmjs.org/codeden/latest"]);
    await s.status({ refresh: true });
    expect(r.calls).toHaveLength(2);
    now += 25 * 3600_000;
    await s.status();
    expect(r.calls).toHaveLength(3);
  });

  it("is quiet when up to date, offline or switched off", async () => {
    const same = new UpdateService({
      enabled: () => true,
      fetch: registry("0.1.0").fetch,
      current: "0.1.0",
    });
    expect((await same.status()).updateAvailable).toBe(false);
    const offline = new UpdateService({
      enabled: () => true,
      fetch: registry(null).fetch,
      current: "0.1.0",
    });
    expect(await offline.status()).toMatchObject({ latest: null, updateAvailable: false });
    expect((await offline.status()).error).toContain("ENOTFOUND");
    const off = registry("9.9.9");
    const disabled = new UpdateService({
      enabled: () => false,
      fetch: off.fetch,
      current: "0.1.0",
    });
    expect(await disabled.status()).toMatchObject({ enabled: false, updateAvailable: false });
    expect(off.calls).toEqual([]);
  });
});
