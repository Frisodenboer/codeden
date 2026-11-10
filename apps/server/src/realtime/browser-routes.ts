import { BrowserWsQuery } from "@codeden/contracts";
import { upgradeWebSocket } from "@hono/node-server";
import type { Hono } from "hono";
import type { AppServices } from "../services/container";
import { BrowserBridge } from "./browser";

/** Paths only the machine itself may use, even with network access on (§15.1). */
export const BROWSER_LOOPBACK_ONLY_PATHS = ["/ws/browser-host"] as const;

/**
 * The browser sockets (§12.2, §17 Phase 2):
 * - `/ws/browser`: one viewer of one session's browser (frames, tabs, input, viewport);
 * - `/ws/browser-host`: the desktop app offering native views (loopback only).
 * Returns the bridge, which also takes the runner's browser stream data.
 */
export function mountBrowserSockets(
  app: Hono,
  services: Pick<AppServices, "browser" | "sessionRepo">,
  log: (message: string) => void,
): BrowserBridge {
  const bridge = new BrowserBridge({ browser: services.browser, log });
  app.get("/ws/browser", async (c, next) => {
    const query = BrowserWsQuery.safeParse(c.req.query());
    if (!query.success)
      return c.json({ error: { code: "bad_request", message: "Invalid browser query" } }, 400);
    if (!services.sessionRepo.find(query.data.sessionId))
      return c.json({ error: { code: "session_not_found", message: "No such session" } }, 404);
    return upgradeWebSocket(() => bridge.handlers(query.data))(c, next);
  });
  app.get(
    "/ws/browser-host",
    upgradeWebSocket(() => services.browser.host.handlers()),
  );
  return bridge;
}
