import type { Session, Snapshot, UpdateSessionRequest } from "@codeden/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { useClient } from "@/lib/api";
import { snapshotKey, useSnapshotData } from "@/lib/queries";
import { useComposerStore } from "@/stores/composer";
import { ModelPicker } from "./model-picker/model-picker";
import { AutonomyPicker } from "./pickers";

function changeSummary(patch: UpdateSessionRequest): string {
  if (patch.model !== undefined && patch.effort !== undefined) return "Model and effort changed";
  return patch.model !== undefined ? "Model changed" : "Effort changed";
}

/**
 * Model and effort for a session: a change is saved with `PATCH /api/sessions/:id` and applies
 * from the next turn (a running turn keeps its settings). The provider is fixed for the life of
 * a session, so the picker shows the other providers locked.
 */
export function SessionOptions({ session, running }: { session: Session; running: boolean }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const providers = useSnapshotData((s) => s.runner.providers, []);
  const autonomy = useComposerStore((s) => s.options[session.id]?.autonomy ?? session.autonomy);
  const setOptions = useComposerStore((s) => s.setOptions);
  const update = useMutation({
    mutationFn: (patch: UpdateSessionRequest) => client.updateSession(session.id, patch),
    onSuccess: (updated, patch) => {
      queryClient.setQueryData<Snapshot>(snapshotKey, (s) =>
        s ? { ...s, sessions: s.sessions.map((x) => (x.id === updated.id ? updated : x)) } : s,
      );
      toast.success(changeSummary(patch), {
        id: `session-options-${session.id}`,
        description: running ? "Applies from the next turn." : undefined,
      });
    },
    onError: (e) => toast.error("Couldn't change the session", { description: e.message }),
  });
  // Changes go out one at a time, so a model pick and an effort pick land in order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const save = (patch: UpdateSessionRequest) => {
    queue.current = queue.current.then(() => update.mutateAsync(patch)).catch(() => {});
  };

  return (
    <>
      <ModelPicker
        providers={providers}
        lockedProvider={session.provider}
        value={{ provider: session.provider, model: session.model, effort: session.effort }}
        shortcut
        onChange={(next) => {
          const patch: UpdateSessionRequest = {};
          if (next.model !== session.model) patch.model = next.model;
          if (next.effort !== session.effort) patch.effort = next.effort;
          if (patch.model !== undefined || patch.effort !== undefined) save(patch);
        }}
      />
      {session.role === "agent" && (
        <AutonomyPicker
          value={autonomy}
          onChange={(a) =>
            setOptions(
              session.id,
              { autonomy: a },
              {
                provider: session.provider,
                model: session.model,
                effort: session.effort,
                autonomy: session.autonomy,
              },
            )
          }
        />
      )}
    </>
  );
}
