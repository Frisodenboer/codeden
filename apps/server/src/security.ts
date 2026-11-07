import type { MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { tokensEqual } from "./token";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export interface SecurityOptions {
  /** The per-install token. */
  token: string;
  /** Cookie name; includes the port so side-by-side installs don't clash (cookies ignore ports). */
  cookieName: () => string;
  /** Exact origins allowed to call the API (scheme://host:port). */
  allowedOrigins: () => ReadonlySet<string>;
  /** Paths reachable without a token (still subject to Host/Origin checks). */
  publicPaths?: ReadonlySet<string>;
}

/** Hostname part of a Host header (`127.0.0.1:4317` -> `127.0.0.1`, `[::1]:80` -> `[::1]`). */
export function hostnameOf(host: string): string {
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  const colon = host.lastIndexOf(":");
  return colon === -1 ? host : host.slice(0, colon);
}

/** Origins for a server listening on `port`. */
export function loopbackOrigins(port: number): string[] {
  return [`http://127.0.0.1:${port}`, `http://localhost:${port}`, `http://[::1]:${port}`];
}

/**
 * Request checks (§15):
 * 1. `Host` must be a loopback name (blocks DNS rebinding).
 * 2. `Origin`, when present, must be one of ours (blocks other websites, including other
 *    localhost ports, which count as same-site for cookies).
 * 3. A valid token via `Authorization: Bearer`, the HttpOnly cookie, or `?token=` (which is
 *    exchanged for the cookie and stripped from the URL with a redirect).
 */
export function securityMiddleware(opts: SecurityOptions): MiddlewareHandler {
  return async (c, next) => {
    const host = c.req.header("host");
    if (!host || !LOOPBACK_HOSTS.has(hostnameOf(host).toLowerCase())) {
      return c.text("Forbidden host", 403);
    }
    const origin = c.req.header("origin");
    if (origin && !opts.allowedOrigins().has(origin)) {
      return c.text("Forbidden origin", 403);
    }
    if (opts.publicPaths?.has(c.req.path)) return next();

    const queryToken = c.req.query("token");
    if (queryToken !== undefined) {
      if (!tokensEqual(queryToken, opts.token)) return c.text("Invalid token", 401);
      setCookie(c, opts.cookieName(), opts.token, {
        httpOnly: true,
        sameSite: "Strict",
        path: "/",
      });
      if (c.req.method === "GET" && !c.req.path.startsWith("/api/") && c.req.path !== "/ws") {
        const url = new URL(c.req.url);
        url.searchParams.delete("token");
        return c.redirect(`${url.pathname}${url.search}${url.hash}`, 302);
      }
      return next();
    }

    const auth = c.req.header("authorization");
    const bearer = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : undefined;
    if (
      tokensEqual(bearer, opts.token) ||
      tokensEqual(getCookie(c, opts.cookieName()), opts.token)
    ) {
      return next();
    }

    if (c.req.header("accept")?.includes("text/html")) {
      return c.html(UNAUTHORIZED_PAGE, 401);
    }
    return c.json({ error: { code: "unauthorized", message: "Missing or invalid token" } }, 401);
  };
}

const UNAUTHORIZED_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>CodeDen</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0d10;color:#e6e8eb;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:28rem;text-align:center}code{background:#1b1f24;padding:.15rem .4rem;border-radius:.3rem}</style></head>
<body><main><h1>CodeDen is locked</h1><p>Open CodeDen with <code>npx codeden</code> to get an authenticated link.</p></main></body></html>`;
