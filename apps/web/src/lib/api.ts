import { Snapshot } from "@codeden/contracts";
import type { AppType } from "@codeden/server";
import { queryOptions } from "@tanstack/react-query";
import { hc } from "hono/client";

/**
 * Base URL of the CodeDen server. Same origin by default (the server hosts the UI; in dev
 * Vite proxies /api and /ws). Configurable for a desktop shell later (§17).
 */
export const serverOrigin: string = import.meta.env.VITE_CODEDEN_SERVER ?? window.location.origin;

/** Typed Hono RPC client for the HTTP API. Auth rides on the HttpOnly cookie. */
export const api = hc<AppType>(`${serverOrigin}/api`, {
  init: { credentials: "include" },
});

export const snapshotQuery = queryOptions({
  queryKey: ["snapshot"],
  queryFn: async (): Promise<Snapshot> => {
    const res = await api.snapshot.$get();
    if (!res.ok) throw new Error(`Snapshot failed (${res.status})`);
    // Validate with the shared schema (also avoids deep JSON type instantiation).
    return Snapshot.parse(await (res as Response).json());
  },
  retry: 1,
});
