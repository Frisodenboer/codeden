import type { ProviderInfo, Snapshot } from "@codeden/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { useClient } from "@/lib/api";
import { snapshotKey } from "@/lib/queries";

/**
 * "Refresh models": ask providers for their model lists again, e.g. after a model release or
 * a CLI update. The refreshed lists replace the snapshot's at once (open pickers re-render);
 * the runner's broadcast brings them to other windows.
 */
export function useRefreshModels() {
  const client = useClient();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async (providerIds: readonly string[]) => {
    if (refreshing || providerIds.length === 0) return;
    setRefreshing(true);
    try {
      const results = await Promise.all(providerIds.map((id) => client.refreshModels(id)));
      // Each answer carries every provider; take each refreshed provider from its own answer.
      const fresh = new Map<string, ProviderInfo>();
      results.forEach((r, i) => {
        const provider = r.providers.find((p) => p.id === providerIds[i]);
        if (provider) fresh.set(provider.id, provider);
      });
      queryClient.setQueryData<Snapshot>(snapshotKey, (s) =>
        s
          ? {
              ...s,
              runner: {
                ...s.runner,
                providers: s.runner.providers.map((p) => fresh.get(p.id) ?? p),
              },
            }
          : s,
      );
    } catch (e) {
      toast.error("Couldn't refresh the models", { description: (e as Error).message });
    } finally {
      setRefreshing(false);
    }
  };

  return { refresh, refreshing };
}
