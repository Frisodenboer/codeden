import { existsSync, readFileSync, statSync } from "node:fs";
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
    app.get("/", (c) => c.html(NOT_BUILT));
    return;
  }
  const index = indexReader(join(webDir, "index.html"));
  app.use("/*", serveStatic({ root: webDir }));
  app.get("*", (c) => {
    if (c.req.path.startsWith("/api/")) return c.notFound();
    return c.html(index() ?? NOT_BUILT);
  });
}

const NOT_BUILT =
  "<!doctype html><title>CodeDen</title><p>The web UI is not built. Run <code>pnpm dev</code> or <code>pnpm build</code>.</p>";

/**
 * Reads `index.html` again whenever it changes on disk (a rebuild while the server runs points
 * at new hashed assets); null while it is missing.
 */
export function indexReader(file: string): () => string | null {
  let cached: { mtimeMs: number; size: number; html: string } | null = null;
  return () => {
    try {
      const { mtimeMs, size } = statSync(file);
      if (!cached || cached.mtimeMs !== mtimeMs || cached.size !== size) {
        cached = { mtimeMs, size, html: readFileSync(file, "utf8") };
      }
      return cached.html;
    } catch {
      cached = null;
      return null;
    }
  };
}
