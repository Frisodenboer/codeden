import type { CodeDenClient } from "./client";
import { type Fetcher, isNotAvailable } from "./http";
import type { PrDetails } from "./types";

type UnwiredApi = Pick<CodeDenClient, "getPrDetails" | "listSlashCommands">;

/** Resolve to `fallback` when the server does not have the route yet. */
async function orFallback<T>(request: Promise<T>, fallback: T): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (isNotAvailable(error)) return fallback;
    throw error;
  }
}

/**
 * Parts of the real client whose server APIs are being built separately (PR details, slash
 * commands). They call the planned routes and degrade to empty results when a route does not
 * exist yet.
 */
export function configApi(http: Fetcher): UnwiredApi {
  const { get } = http;
  const enc = encodeURIComponent;
  const noPr: PrDetails = { issue: null, pr: null };

  return {
    getPrDetails: (id) => orFallback(get<PrDetails>(`/sessions/${enc(id)}/github`), noPr),
    listSlashCommands: (id) => orFallback(get(`/sessions/${enc(id)}/commands`), []),
  };
}
