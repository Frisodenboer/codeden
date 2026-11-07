import { createContext, type ReactNode, useContext } from "react";
import type { CodeDenClient } from "./client";
import { createHttpClient } from "./http-client";
import { createMockClient } from "./mock";

export type { CodeDenClient, SendMode } from "./client";

/**
 * Mock mode: `VITE_CODEDEN_MOCK=1` forces it, `0` disables it. When unset, dev builds use the
 * mock (so the UI is explorable without a server) and production builds use the real server.
 */
export const isMockMode: boolean =
  import.meta.env.VITE_CODEDEN_MOCK === "1" ||
  (import.meta.env.VITE_CODEDEN_MOCK === undefined && import.meta.env.DEV);

/** Base URL of the CodeDen server (same origin by default; configurable for a desktop shell). */
export const serverOrigin: string = import.meta.env.VITE_CODEDEN_SERVER ?? window.location.origin;

export function createClient(): CodeDenClient {
  return isMockMode ? createMockClient({ ambient: true }) : createHttpClient(serverOrigin);
}

const ClientContext = createContext<CodeDenClient | null>(null);

export function ClientProvider({
  client,
  children,
}: {
  client: CodeDenClient;
  children: ReactNode;
}) {
  return <ClientContext.Provider value={client}>{children}</ClientContext.Provider>;
}

/** The active API client. */
export function useClient(): CodeDenClient {
  const client = useContext(ClientContext);
  if (!client) throw new Error("useClient must be used inside <ClientProvider>");
  return client;
}
