import { networkInterfaces } from "node:os";
import { expect, test } from "@playwright/test";
import { type E2eServer, startE2eServer } from "./support/server";

/**
 * Network access (§15.1) end to end: an isolated server turns it on, then a phone-sized
 * browser opens CodeDen on this machine's LAN address. The server sees that connection's
 * peer as the LAN address, not loopback, so it is a real remote client: it must sign in with
 * the password, and never reaches /mcp.
 */
const PASSWORD = "maple-river-quiet-orbit-candle";
const lan = Object.values(networkInterfaces())
  .flat()
  .find((i) => i?.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))?.address;

let server: E2eServer;
let remote = "";

async function local(method: string, path: string, body?: unknown) {
  const res = await fetch(`${server.url}/api${path}`, {
    method,
    headers: { authorization: `Bearer ${server.token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test.describe("network access", () => {
  test.skip(!lan, "this machine has no LAN IPv4 address to connect from");

  test.beforeAll(async () => {
    test.setTimeout(120_000);
    server = await startE2eServer();
    const port = new URL(server.url).port;
    remote = `http://${lan}:${port}`;
    await local("POST", "/setup/complete", {});
  });

  test.afterAll(async () => {
    // Back to loopback before stopping, so nothing is left listening on 0.0.0.0.
    if (server) {
      await local("PUT", "/network", { enabled: false }).catch(() => undefined);
      await server.stop();
    }
  });

  test("turns on only with a password, then a phone signs in over the LAN", async ({ browser }) => {
    // Refused without a password: still loopback only.
    expect((await local("PUT", "/network", { enabled: true })).status).toBe(400);
    await expect(fetch(`${remote}/api/health`)).rejects.toThrow();

    expect((await local("POST", "/network/password", { password: PASSWORD })).status).toBe(200);
    const on = await local("PUT", "/network", { enabled: true });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ enabled: true, listening: "network" });
    const urls = (on.body.addresses as { url: string }[]).map((a) => a.url);
    expect(urls).toContain(remote);

    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const phone = await context.newPage();
    try {
      // The install token means nothing from another device.
      await phone.goto(`${remote}/?token=${server.token}`);
      const form = phone.getByTestId("sign-in");
      await expect(form).toBeVisible();
      await expect(phone.getByRole("heading", { name: "Sign in to CodeDen" })).toBeVisible();

      await phone.getByLabel("Password", { exact: true }).fill("not the password at all");
      await phone.getByRole("button", { name: "Sign in" }).click();
      await expect(phone.getByRole("alert")).toContainText("not right");

      await phone.getByLabel("Password", { exact: true }).fill(PASSWORD);
      await phone.getByRole("button", { name: "Sign in" }).click();
      await expect(form).toBeHidden();
      await expect(phone.getByTestId("mobile-nav-button")).toBeVisible();
      const cookies = await context.cookies(remote);
      const session = cookies.find((c) => c.name.startsWith("codeden_session_"));
      expect(session?.httpOnly).toBe(true);
      expect(session?.sameSite).toBe("Lax");

      // The API and the UI socket work with the session; /mcp does not exist out here.
      const snapshot = await phone.request.get(`${remote}/api/snapshot`);
      expect(snapshot.status()).toBe(200);
      expect((await phone.request.post(`${remote}/mcp`, { data: {} })).status()).toBe(404);
      // Management is for the computer running CodeDen.
      const off = await phone.request.put(`${remote}/api/network`, {
        data: { enabled: false },
        headers: { origin: remote },
      });
      expect(off.status()).toBe(403);

      // The device shows up in Settings, and signing everyone out sends it back to sign-in.
      const status = await local("GET", "/network");
      expect((status.body.devices as unknown[]).length).toBe(1);
      expect((await local("DELETE", "/network/devices")).status).toBe(200);
      await phone.reload();
      await expect(phone.getByTestId("sign-in")).toBeVisible();
    } finally {
      await context.close();
    }

    // Off again: nothing answers on the LAN address.
    expect((await local("PUT", "/network", { enabled: false })).status).toBe(200);
    await expect(fetch(`${remote}/api/health`)).rejects.toThrow();
  });
});
