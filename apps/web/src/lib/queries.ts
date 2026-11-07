import type { Project, Session, Snapshot } from "@codeden/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useTranscriptsStore } from "@/stores/transcripts";
import { useClient } from "./api";
import type { TranscriptState } from "./transcript/reducer";

export const snapshotKey = ["snapshot"] as const;

/** The app snapshot (projects, sessions, inbox, automations, settings), kept live by realtime. */
export function useSnapshot() {
  const client = useClient();
  return useQuery({
    queryKey: snapshotKey,
    queryFn: () => client.getSnapshot(),
    staleTime: Infinity,
  });
}

/** Select from the snapshot with a stable fallback. */
export function useSnapshotData<T>(select: (s: Snapshot) => T, fallback: T): T {
  const { data } = useSnapshot();
  return data ? select(data) : fallback;
}

export function useSession(sessionId: string | undefined): Session | undefined {
  return useSnapshotData((s) => s.sessions.find((x) => x.id === sessionId), undefined);
}

export function useProject(projectId: string | null | undefined): Project | undefined {
  return useSnapshotData((s) => s.projects.find((x) => x.id === projectId), undefined);
}

export function useOrchestratorSession(): Session | undefined {
  return useSnapshotData((s) => s.sessions.find((x) => x.role === "orchestrator"), undefined);
}

/** Load a session transcript into the live store and return it. */
export function useTranscript(sessionId: string | undefined): {
  transcript: TranscriptState | undefined;
  isLoading: boolean;
  error: Error | null;
} {
  const client = useClient();
  const query = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => client.getSessionSnapshot(sessionId ?? ""),
    enabled: Boolean(sessionId),
    staleTime: Infinity,
  });
  const load = useTranscriptsStore((s) => s.load);
  useEffect(() => {
    if (query.data) load(query.data);
  }, [query.data, load]);
  const transcript = useTranscriptsStore((s) => (sessionId ? s.byId[sessionId] : undefined));
  return { transcript, isLoading: query.isLoading, error: query.error };
}
