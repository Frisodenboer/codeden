import { useQuery } from "@tanstack/react-query";
import { useClient } from "@/lib/api";

export const updatesKey = ["updates"] as const;

/** The npm registry version check; refetched every few hours while the app stays open. */
export function useUpdates() {
  const client = useClient();
  return useQuery({
    queryKey: updatesKey,
    queryFn: () => client.getUpdates(),
    staleTime: 6 * 3600_000,
    refetchInterval: 6 * 3600_000,
    retry: false,
  });
}

const DISMISSED_KEY = "codeden.update-dismissed";

/** Whether the update notice for `version` was dismissed in this browser. */
export function updateDismissed(version: string): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === version;
  } catch {
    return false;
  }
}

export function dismissUpdate(version: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // private mode: the notice may show again next time
  }
}
