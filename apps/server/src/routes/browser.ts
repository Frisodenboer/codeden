import {
  BrowserDevServerRequest,
  BrowserHistoryRequest,
  BrowserNavigateRequest,
  BrowserNewTabRequest,
  BrowserOpenRequest,
  BrowserViewportRequest,
  type DevServersResponse,
} from "@codeden/contracts";
import { Hono } from "hono";
import { z } from "zod";
import type { AppServices } from "../services/container";
import { jsonBody, queryOf } from "./validate";

/**
 * Session browser routes under `/api/sessions/:id/browser` (§12.2). The live view and human
 * input go over `/ws/browser`; these cover opening, tabs, navigation, viewport and dev servers.
 */
export function sessionBrowserRoutes(s: AppServices) {
  const b = s.browser;
  return new Hono()
    .post("/:id/browser/open", jsonBody(BrowserOpenRequest), async (c) => {
      const { url, native } = c.req.valid("json");
      return c.json(await b.open(c.req.param("id"), url, { native }));
    })
    .post("/:id/browser/close", async (c) => {
      await b.command({ name: "browser.close", sessionId: c.req.param("id") });
      return c.json({ ok: true as const });
    })
    .get("/:id/browser/tabs", async (c) => c.json(await b.tabs(c.req.param("id"))))
    .post("/:id/browser/tabs", jsonBody(BrowserNewTabRequest), async (c) =>
      c.json(
        await b.command({
          name: "browser.tabs.open",
          sessionId: c.req.param("id"),
          url: c.req.valid("json").url,
        }),
      ),
    )
    .delete("/:id/browser/tabs/:tabId", async (c) => {
      const { id, tabId } = c.req.param();
      await b.command({ name: "browser.tabs.close", sessionId: id, tabId });
      return c.json({ ok: true as const });
    })
    .post("/:id/browser/tabs/:tabId/activate", async (c) => {
      const { id, tabId } = c.req.param();
      await b.command({ name: "browser.tabs.activate", sessionId: id, tabId });
      return c.json({ ok: true as const });
    })
    .post("/:id/browser/navigate", jsonBody(BrowserNavigateRequest), async (c) => {
      const { url, tabId } = c.req.valid("json");
      return c.json(await b.navigate(c.req.param("id"), url, tabId));
    })
    .post("/:id/browser/history", jsonBody(BrowserHistoryRequest), async (c) => {
      const { action, tabId } = c.req.valid("json");
      return c.json(
        await b.command({ name: "browser.history", sessionId: c.req.param("id"), action, tabId }),
      );
    })
    .post("/:id/browser/viewport", jsonBody(BrowserViewportRequest), async (c) => {
      const { width, height } = c.req.valid("json");
      await b.command({ name: "browser.viewport", sessionId: c.req.param("id"), width, height });
      return c.json({ ok: true as const });
    })
    .post("/:id/browser/dev-server", jsonBody(BrowserDevServerRequest), async (c) => {
      const { port, path } = c.req.valid("json");
      return c.json(
        await b.command({ name: "browser.devServer", sessionId: c.req.param("id"), port, path }),
      );
    });
}

const ProbeQuery = z.object({
  /** Comma-separated ports to probe in addition to the runner's own child processes. */
  probe: z
    .string()
    .regex(/^\d{1,5}(,\d{1,5})*$/)
    .optional(),
});

/** `/api/browser`: dev-server discovery for the panel's one-click open. */
export function browserRoutes(s: AppServices) {
  return new Hono().get("/dev-servers", queryOf(ProbeQuery), async (c) => {
    const raw = c.req.valid("query").probe;
    const probe = raw
      ?.split(",")
      .map(Number)
      .filter((p) => p >= 1 && p <= 65535);
    const body: DevServersResponse = { servers: await s.browser.devServers(probe) };
    return c.json(body);
  });
}
