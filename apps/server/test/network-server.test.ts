import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import { join } from "node:path";
import type { NetworkStatus } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type RunningServer, startServer } from "../src";

/**
 * Network access against a real server: the listener moves between 127.0.0.1 and 0.0.0.0 on
 * the same port. When this machine has a LAN IPv4 address, connecting to it from here makes
 * the server see a non-loopback peer, which is a real remote request.
 */
const TOKEN = "n".repeat(64);
const GOOD = "maple-river-quiet-orbit-candle";
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const lanAddress = Object.values(networkInterfaces())
  .flat()
  .find((i) => i?.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))?.address;

let home: string;
let server: RunningServer | undefined;

const start = () =>
  startServer({
    port: 0,
    dataDir: home,
    token: TOKEN,
    runner: false,
    secrets: "memory",
    checkSetupOnStart: false,
  });

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "codeden-netsrv-"));
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  rmSync(home, { recursive: true, force: true });
});

async function api(path: string, init: RequestInit = {}) {
  const s = server as RunningServer;
  return fetch(`${s.url}${path}`, { ...init, headers: { ...auth, ...init.headers } });
}

describe("network access on a real server", () => {
  it("binds 127.0.0.1 by default and refuses to go wider without a password", async () => {
    server = await start();
    const status = (await (await api("/api/network")).json()) as NetworkStatus;
    expect(status).toMatchObject({ enabled: false, passwordSet: false, listening: "loopback" });
    expect(status.addresses).toHaveLength(1);
    const on = await api("/api/network", {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
    });
    expect(on.status).toBe(400);
    expect(server.network.desiredHost()).toBe("127.0.0.1");
  });

  it("stays on loopback at startup when the file says on but has no password", async () => {
    writeFileSync(join(home, "remote-access.json"), JSON.stringify({ enabled: true }));
    server = await start();
    expect(server.network.enabled).toBe(false);
    expect(await (await api("/api/network")).json()).toMatchObject({ listening: "loopback" });
  });

  it("moves the listener to 0.0.0.0 on the same port and back, keeping local connections", async () => {
    server = await start();
    const port = server.port;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, {
      headers: { authorization: auth.authorization },
    });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    expect(
      (
        await api("/api/network/password", {
          method: "POST",
          body: JSON.stringify({ password: GOOD }),
        })
      ).status,
    ).toBe(200);
    const on = await api("/api/network", {
      method: "PUT",
      body: JSON.stringify({ enabled: true }),
    });
    expect(on.status).toBe(200);
    expect(await on.json()).toMatchObject({ enabled: true, listening: "network", port });
    expect(server.port).toBe(port);
    // The UI socket opened before the switch is still connected.
    expect(ws.readyState).toBe(WebSocket.OPEN);
    expect((await api("/api/health")).status).toBe(200);

    const off = await api("/api/network", {
      method: "PUT",
      body: JSON.stringify({ enabled: false }),
    });
    expect(await off.json()).toMatchObject({ enabled: false, listening: "loopback" });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
  });

  it.skipIf(!lanAddress)("signs in a real remote peer on the LAN address", async () => {
    server = await start();
    const port = server.port;
    await api("/api/network/password", {
      method: "POST",
      body: JSON.stringify({ password: GOOD }),
    });
    await api("/api/network", { method: "PUT", body: JSON.stringify({ enabled: true }) });
    const remote = `http://${lanAddress}:${port}`;

    // Signed out: the UI shell loads, the API asks for a sign-in, /mcp does not exist.
    expect((await fetch(`${remote}/`)).status).toBe(200);
    const locked = await fetch(`${remote}/api/snapshot`, {
      headers: { authorization: auth.authorization },
    });
    expect(locked.status).toBe(401);
    expect((await fetch(`${remote}/mcp`, { method: "POST" })).status).toBe(404);

    const signIn = await fetch(`${remote}/api/auth/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: remote, "user-agent": "E2E phone" },
      body: JSON.stringify({ password: GOOD }),
    });
    expect(signIn.status).toBe(200);
    const cookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0] as string;
    expect((await fetch(`${remote}/api/snapshot`, { headers: { cookie } })).status).toBe(200);
    expect((await fetch(`${remote}/mcp`, { method: "POST", headers: { cookie } })).status).toBe(
      404,
    );

    const ws = new WebSocket(`ws://${lanAddress}:${port}/ws`, {
      headers: { cookie, origin: remote },
    });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const closed = new Promise((resolve) => ws.once("close", resolve));

    // Signing everyone out closes the remote socket; the cookie no longer works.
    await api("/api/network/devices", { method: "DELETE" });
    await closed;
    expect((await fetch(`${remote}/api/snapshot`, { headers: { cookie } })).status).toBe(401);

    // Off: nothing answers on the LAN address any more.
    await api("/api/network", { method: "PUT", body: JSON.stringify({ enabled: false }) });
    await expect(fetch(`${remote}/api/health`)).rejects.toThrow();
  });
});
