import type { Session } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { toast } from "sonner";
import { ThreadView } from "@/components/thread/thread-view";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/api";
import type { OrchestrationRole } from "@/lib/api/feature-apis";
import { useProject, useSnapshotData } from "@/lib/queries";
import { getDraft, useComposerStore } from "@/stores/composer";
import { ReadOnlyBadge, RoleBadge } from "./role-badge";

/** Composer draft key while the role session does not exist yet. */
export const roleDraftKey = (role: OrchestrationRole, projectId: string | null) =>
  role === "orchestrator" ? "role:orchestrator" : `role:pm:${projectId}`;

/** The orchestrator or a project's PM session from the snapshot (`roleSessions` first). */
export function useRoleSession(
  role: OrchestrationRole,
  projectId: string | null,
): Session | undefined {
  return useSnapshotData((s) => {
    const ref =
      role === "orchestrator" ? s.roleSessions?.orchestrator : s.roleSessions?.pms[projectId ?? ""];
    const byRef = ref ? s.sessions.find((x) => x.id === ref) : undefined;
    if (byRef) return byRef;
    return s.sessions
      .filter((x) => x.role === role && (role === "orchestrator" || x.projectId === projectId))
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  }, undefined);
}

/** Composer for a role session that does not exist yet: the first message creates it. */
function StartComposer({
  kind: role,
  projectId,
}: {
  kind: OrchestrationRole;
  projectId: string | null;
}) {
  const client = useClient();
  const key = roleDraftKey(role, projectId);
  const draft = useComposerStore((s) => getDraft(s, key));
  const focusToken = useComposerStore((s) => s.focusToken);
  const { setText, clear } = useComposerStore.getState();
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusToken > 0) ref.current?.focus();
  }, [focusToken]);
  const send = useMutation({
    mutationFn: (text: string) => client.orchestration.send(role, projectId, { text }),
    onMutate: () => clear(key),
    onError: (e, text) => {
      setText(key, text);
      toast.error("Message not sent", { description: e.message });
    },
  });
  const text = draft.text.trim();
  return (
    <div className="mx-auto w-full max-w-[46rem] px-6 pb-5">
      <div className="rounded-2xl border border-border bg-card shadow-[0_10px_30px_-18px] shadow-black/40 focus-within:border-primary/35">
        <textarea
          ref={ref}
          value={draft.text}
          rows={1}
          onChange={(e) => setText(key, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              if (text) send.mutate(text);
            }
          }}
          placeholder={
            role === "orchestrator"
              ? "Ask the orchestrator to start a project, triage issues or check on work…"
              : "Message the project manager…"
          }
          aria-label="Message"
          className="block max-h-64 min-h-[56px] w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[14px] leading-relaxed outline-none [field-sizing:content] placeholder:text-muted-foreground/70"
        />
        <div className="flex items-center px-2 pb-2">
          <span className="px-2 text-2xs text-muted-foreground">
            The first message starts the {role === "orchestrator" ? "orchestrator" : "PM"}.
          </span>
          <Button
            size="icon-sm"
            className="ml-auto rounded-full"
            onClick={() => text && send.mutate(text)}
            disabled={!text || send.isPending}
            aria-label="Send"
          >
            <ArrowUp />
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The orchestrator chat or a project's PM chat (§8.1). Uses the role session when it exists;
 * otherwise the first message creates it through `/api/orchestration`.
 */
export function RoleChat({
  kind: role,
  projectId,
  empty,
}: {
  /** Which role chat: the orchestrator or a project's PM. */
  kind: OrchestrationRole;
  projectId: string | null;
  /** Empty-state content; gets the composer draft key suggestions should write to. */
  empty: (draftKey: string) => ReactNode;
}) {
  const session = useRoleSession(role, projectId);
  const project = useProject(projectId);
  if (session) return <ThreadView sessionId={session.id} empty={empty(session.id)} />;
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="role-chat-start">
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <RoleBadge role={role} />
        <h1 className="truncate text-[14px] font-medium">
          {role === "orchestrator"
            ? "Orchestrator"
            : `${project?.name ?? "Project"} · Project manager`}
        </h1>
        <span className="text-2xs text-muted-foreground">Not started</span>
        <ReadOnlyBadge className="ml-auto" />
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {empty(roleDraftKey(role, projectId))}
      </div>
      <StartComposer kind={role} projectId={projectId} />
    </div>
  );
}
