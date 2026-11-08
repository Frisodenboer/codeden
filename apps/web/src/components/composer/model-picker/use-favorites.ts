import type { ModelRef, Snapshot } from "@codeden/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useClient } from "@/lib/api";
import { snapshotKey, useSnapshotData } from "@/lib/queries";
import { toggleFavorite } from "./logic";

const NONE: ModelRef[] = [];

const read = (s: Snapshot | undefined): ModelRef[] => s?.settings.models?.favorites ?? NONE;

/**
 * Favourite models from settings (`models.favorites`). A toggle shows at once (the snapshot is
 * updated in place) and is saved as the whole list, which settings patches replace.
 */
export function useFavoriteModels(): {
  favorites: ModelRef[];
  toggle: (ref: ModelRef) => void;
} {
  const client = useClient();
  const queryClient = useQueryClient();
  const favorites = useSnapshotData(read, NONE);
  const toggle = (ref: ModelRef) => {
    const next = toggleFavorite(read(queryClient.getQueryData<Snapshot>(snapshotKey)), ref);
    queryClient.setQueryData<Snapshot>(snapshotKey, (s) =>
      s
        ? { ...s, settings: { ...s.settings, models: { ...s.settings.models, favorites: next } } }
        : s,
    );
    client.updateSettings({ models: { favorites: next } }).catch((e: Error) => {
      toast.error("Favourite not saved", { description: e.message });
      void queryClient.invalidateQueries({ queryKey: snapshotKey });
    });
  };
  return { favorites, toggle };
}
