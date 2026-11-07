/** A failed API call, with the server's error code when it sent one. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

/** True for errors from routes this server does not have yet (older or partial server). */
export function isNotAvailable(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 404 || error.status === 501);
}

export interface Fetcher {
  call<T>(method: string, path: string, body?: unknown, parse?: (v: unknown) => T): Promise<T>;
  get<T>(path: string, parse?: (v: unknown) => T): Promise<T>;
  post<T = void>(path: string, body?: unknown, parse?: (v: unknown) => T): Promise<T>;
}

/**
 * JSON fetch against `<origin>/api`. Auth rides on the HttpOnly cookie set by the launch URL
 * (§15); a 401 calls `onUnauthorized` so the app can show the "open from the terminal" screen.
 */
export function createFetcher(origin: string, onUnauthorized: () => void): Fetcher {
  const base = `${origin}/api`;
  async function call<T>(
    method: string,
    path: string,
    body?: unknown,
    parse?: (v: unknown) => T,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        credentials: "include",
        headers:
          body === undefined
            ? { accept: "application/json" }
            : { accept: "application/json", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiRequestError(0, "network", "Can't reach the CodeDen server");
    }
    if (res.status === 401) onUnauthorized();
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string };
      } | null;
      throw new ApiRequestError(
        res.status,
        payload?.error?.code ?? (res.status === 404 ? "not_found" : "http_error"),
        payload?.error?.message ?? `${method} ${path} failed (${res.status})`,
      );
    }
    if (res.status === 204) return undefined as T;
    const json: unknown = await res.json();
    return parse ? parse(json) : (json as T);
  }
  return {
    call,
    get: (path, parse) => call("GET", path, undefined, parse),
    post: (path, body, parse) => call("POST", path, body ?? {}, parse),
  };
}

/** `ws://` / `wss://` URL for a path on the server. */
export function socketUrl(origin: string, path: string): string {
  return `${origin.replace(/^http/, "ws")}${path}`;
}
