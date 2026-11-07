import type { Session, UpdateSessionRequest } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useClient } from "@/lib/api";
import { useSnapshotData } from "@/lib/queries";
import { useComposerStore } from "@/stores/composer";
import { AutonomyPicker, EffortPicker, ModelPicker } from "./pickers";

/**
 * Model and effort pickers for a running session: a change is saved with
 * `PATCH /api/sessions/:id` and applies from the next turn (a running turn keeps its settings).
 * The provider is fixed for the life of a session, so only its own models are offered.
 */
export function SessionOptions({ session, running }: { session: Session; running: boolean }) {
  const client = useClient();
  const providers = useSnapshotData((s) => s.runner.providers, []);
  const autonomy = useComposerStore((s) => s.options[session.id]?.autonomy ?? session.autonomy);
  const setOptions = useComposerStore((s) => s.setOptions);
  const provider = providers.find((p) => p.id === session.provider);
  const model =
    provider?.models.find((m) => m.id === session.model) ??
    provider?.models.find((m) => m.isDefault);
  const update = useMutation({
    mutationFn: (patch: UpdateSessionRequest) => client.updateSession(session.id, patch),
    onSuccess: (_s, patch) => {
      const what = patch.model !== undefined ? "Model" : "Effort";
      toast.success(`${what} changed`, {
        description: running ? "Applies from the next turn." : undefined,
      });
    },
    onError: (e) => toast.error("Couldn't change the session", { description: e.message }),
  });

  return (
    <>
      <ModelPicker
        providers={provider ? [provider] : []}
        provider={session.provider}
        model={session.model ?? model?.id ?? null}
        disabled={update.isPending}
        onChange={(_p, m) => {
          if (m !== (session.model ?? model?.id)) update.mutate({ model: m });
        }}
      />
      {provider?.capabilities.reasoningEffort && (
        <EffortPicker
          efforts={model?.efforts ?? []}
          value={session.effort ?? model?.defaultEffort ?? null}
          onChange={(effort) => {
            if (effort !== session.effort) update.mutate({ effort });
          }}
        />
      )}
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
