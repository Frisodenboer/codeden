import type { UpdateStatus } from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { create } from "zustand";
import { useClient } from "@/lib/api";

export const updatesKey = ["updates"] as const;

/** The update check and self-update state; pushed live over the WebSocket (`update` messages). */
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

/** Install / restart / roll back; each answers with the new status. */
export function useUpdateActions() {
  const client = useClient();
  const queryClient = useQueryClient();
  const onSuccess = (status: UpdateStatus) => queryClient.setQueryData(updatesKey, status);
  return {
    install: useMutation({ mutationFn: () => client.updates.install(), onSuccess }),
    restart: useMutation({ mutationFn: () => client.updates.restart(), onSuccess }),
    rollback: useMutation({ mutationFn: () => client.updates.rollback(), onSuccess }),
  };
}

type HandoverPhase = "idle" | "waiting" | "timeout";

interface HandoverState {
  phase: HandoverPhase;
  target: string | null;
  set: (phase: HandoverPhase, target: string | null) => void;
}

/** The browser's side of a restart: waiting for the new server, or given up. */
export const useHandoverStore = create<HandoverState>()((set) => ({
  phase: "idle",
  target: null,
  set: (phase, target) => set({ phase, target }),
}));

const UPDATED_KEY = "codeden.updated-to";
const HANDOVER_TIMEOUT_MS = 120_000;

/**
 * While the server restarts into `target`: poll `/api/health` and reload the page once the new
 * version answers (the auth cookie survives: same port, same install token). If another version
 * comes back after the server went away (the new one failed and the old one restarted), reload
 * too so the failure shows. After two minutes, ask for a manual restart instead. The polling
 * outlives status changes (the new server's first status is no longer "restarting").
 */
export function useHandover(status: UpdateStatus | undefined): void {
  const client = useClient();
  const restarting = status?.state === "restarting" ? status.target : null;
  useEffect(() => {
    if (restarting) startHandover(restarting, () => client.updates.serverVersion());
  }, [restarting, client]);
}

function startHandover(target: string, serverVersion: () => Promise<string | null>): void {
  const store = useHandoverStore.getState();
  if (store.phase === "waiting" && store.target === target) return;
  store.set("waiting", target);
  let sawDown = false;
  const started = Date.now();
  const tick = async () => {
    const version = await serverVersion();
    if (version === target) {
      remember(UPDATED_KEY, target);
      window.location.reload();
      return;
    }
    if (version === null) sawDown = true;
    else if (sawDown) {
      window.location.reload();
      return;
    }
    if (Date.now() - started > HANDOVER_TIMEOUT_MS) {
      useHandoverStore.getState().set("timeout", target);
      return;
    }
    setTimeout(() => void tick(), 1000);
  };
  setTimeout(() => void tick(), 800);
}

/** The version this page reloaded into after a hand-over (read once per page load). */
export const updatedTo: string | null = takeOnce(UPDATED_KEY);

function takeOnce(key: string): string | null {
  try {
    const value = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}

function remember(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // private mode: no "updated" toast after the reload
  }
}

const DISMISSED_KEY = "codeden.update-dismissed";

/** Whether the update notice for `version` was dismissed ("Later") in this browser. */
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
