import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { isLoopbackAddress, normalizeAddress } from "./network/addresses";
import { tokensEqual } from "./token";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/** Files a browser fetches without cookies to install the app (manifest, icons). */
const PWA_FILES = new Set([
  "/manifest.webmanifest",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
]);

/** Sign-in endpoints a signed-out remote device may call. */
const AUTH_PATHS = new Set(["/api/auth/status", "/api/auth/sign-in", "/api/auth/sign-out"]);

/** What the security middleware needs to know about network access (§15.1). */
export interface RemoteAuth {
  /** Network access is on (switched on, with a password). */
  enabled(): boolean;
  /** The machine's own LAN/VPN hosts, accepted in `Host` and `Origin` while enabled. */
  ownHosts(): ReadonlySet<string>;
  /** The server's port (Host/Origin for own addresses must name it). */
  port(): number;
  /** Cookie holding a remote session token. */
  sessionCookieName(): string;
  /** The live session for a token, if any. */
  verifySession(token: string | undefined): { id: string } | undefined;
}

export interface SecurityOptions {
  /** The per-install token. */
  token: string;
  /** Cookie name; includes the port so side-by-side installs don't clash (cookies ignore ports). */
  cookieName: () => string;
  /** Exact origins allowed to call the API (scheme://host:port). */
  allowedOrigins: () => ReadonlySet<string>;
  /** Paths reachable without a token (still subject to Host/Origin checks). */
  publicPaths?: ReadonlySet<string>;
  /** Paths that only this machine may reach, even with network access on (404 to others). */
  loopbackOnlyPaths?: ReadonlySet<string>;
  /** Network access; omitted means loopback only. */
  remote?: RemoteAuth;
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
 * The connection's peer address, from the socket itself. Headers such as `X-Forwarded-For`
 * are never consulted, so they can't make a request look local. Unknown counts as remote.
 */
export function peerAddress(c: Context): string {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return normalizeAddress(env?.incoming?.socket?.remoteAddress);
}

/** Did this request come from another device? */
export function isRemoteRequest(c: Context): boolean {
  return !isLoopbackAddress(peerAddress(c));
}

/** `Host` values for the machine's own addresses on `port`. */
function ownHostValues(remote: RemoteAuth): Set<string> {
  const port = remote.port();
  const values = new Set<string>();
  for (const host of remote.ownHosts()) {
    values.add(`${host}:${port}`);
    if (port === 80) values.add(host);
  }
  return values;
}

/** Static UI files (served to signed-out remote devices so they can show the sign-in page). */
function isShellRequest(c: Context): boolean {
  const path = c.req.path;
  return (
    (c.req.method === "GET" || c.req.method === "HEAD") &&
    !path.startsWith("/api/") &&
    path !== "/ws" &&
    !path.startsWith("/ws/") &&
    path !== "/mcp"
  );
}

/**
 * Request checks (§15, §15.1):
 * 1. `Host` must be a loopback name, or, with network access on, one of this machine's own
 *    LAN/VPN addresses on the server port (blocks DNS rebinding).
 * 2. `Origin`, when present, must be one of ours (blocks other websites, including other
 *    ports on the same host, which count as same-site for cookies, and `null`).
 * 3. Loopback peers need the install token via `Authorization: Bearer`, the HttpOnly cookie,
 *    or `?token=` (exchanged for the cookie and stripped from the URL with a redirect).
 * 4. Remote peers need a remote session cookie (from the password sign-in); the install token
 *    is never accepted from them, and loopback-only paths answer 404.
 */
export function securityMiddleware(opts: SecurityOptions): MiddlewareHandler {
  return async (c, next) => {
    const remote = isRemoteRequest(c);
    const networkOn = opts.remote?.enabled() ?? false;
    if (remote && !networkOn) return c.text("Network access is off", 403);

    const host = c.req.header("host");
    const hostName = host ? hostnameOf(host).toLowerCase() : "";
    const hostOk =
      Boolean(host) &&
      (LOOPBACK_HOSTS.has(hostName) ||
        (networkOn && opts.remote !== undefined && ownHostValues(opts.remote).has(host as string)));
    if (!hostOk) return c.text("Forbidden host", 403);

    const origin = c.req.header("origin");
    if (origin && !opts.allowedOrigins().has(origin)) {
      return c.text("Forbidden origin", 403);
    }

    if (remote) return remoteGate(c, next, opts);

    if (opts.publicPaths?.has(c.req.path) || PWA_FILES.has(c.req.path)) return next();
    if (AUTH_PATHS.has(c.req.path)) return next();

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

/** Remote peers: loopback-only paths are hidden, everything else needs a session. */
async function remoteGate(
  c: Context,
  next: () => Promise<void>,
  opts: SecurityOptions,
): Promise<Response | undefined> {
  const path = c.req.path;
  if (opts.loopbackOnlyPaths?.has(path)) return c.text("Not found", 404);
  if (path === "/api/health" || AUTH_PATHS.has(path) || PWA_FILES.has(path)) {
    await next();
    return;
  }
  const session = opts.remote?.verifySession(getCookie(c, opts.remote.sessionCookieName()));
  if (session) {
    await next();
    return;
  }
  // The UI itself is public (it is the open-source bundle): it shows the sign-in page.
  if (isShellRequest(c)) {
    await next();
    return;
  }
  return c.json({ error: { code: "sign_in_required", message: "Sign in to CodeBench" } }, 401);
}

const UNAUTHORIZED_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>CodeBench</title>
<style>body{font-family:system-ui,sans-serif;background:#0b0d10;color:#e6e8eb;display:grid;place-items:center;height:100vh;margin:0}
main{max-width:28rem;text-align:center}code{background:#1b1f24;padding:.15rem .4rem;border-radius:.3rem}</style></head>
<body><main><h1>CodeBench is locked</h1><p>Open CodeBench with <code>npx codeden</code> to get an authenticated link.</p></main></body></html>`;
