import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";

/** Locate built web assets: a bundle's `web/` folder, or `apps/web/dist` in the monorepo. */
export function findWebDir(explicit?: string): string | undefined {
  const here = import.meta.dirname;
  const candidates = [explicit, resolve(here, "web"), resolve(here, "../../../web/dist")];
  return candidates.find(
    (c): c is string => Boolean(c) && existsSync(join(c as string, "index.html")),
  );
}

/** Serve the SPA: static files, then `index.html` for any other non-API GET (client routing). */
export function mountWeb(app: Hono, webDir: string | undefined): void {
  if (!webDir) {
    app.get("/", (c) =>
      c.html(
        "<!doctype html><title>CodeDen</title><p>The web UI is not built. Run <code>pnpm dev</code> or <code>pnpm build</code>.</p>",
      ),
    );
    return;
  }
  const index = readFileSync(join(webDir, "index.html"), "utf8");
  app.use("/*", serveStatic({ root: webDir }));
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.notFound();
    return c.html(index);
  });
}
