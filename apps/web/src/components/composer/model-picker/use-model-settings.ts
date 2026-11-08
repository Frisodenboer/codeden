import type { ModelRef, Settings, SettingsPatch, Snapshot } from "@codeden/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useClient } from "@/lib/api";
import { snapshotKey, useSnapshotData } from "@/lib/queries";
import { type HiddenModels, toggleHidden } from "./hidden";
import { toggleFavorite } from "./logic";

type ModelsSettings = Settings["models"];
const NONE: ModelsSettings = { favorites: [], hidden: {} };

const read = (s: Snapshot | undefined): ModelsSettings => s?.settings.models ?? NONE;

/**
 * Read `settings.models` and save changes to it. A change shows at once (the snapshot is
 * updated in place) and is then saved; lists in a settings patch replace the stored ones.
 */
function useModelsSettings() {
  const client = useClient();
  const queryClient = useQueryClient();
  const models = useSnapshotData(read, NONE);
  const current = () => read(queryClient.getQueryData<Snapshot>(snapshotKey));
  const save = (next: ModelsSettings, patch: SettingsPatch) => {
    queryClient.setQueryData<Snapshot>(snapshotKey, (s) =>
      s ? { ...s, settings: { ...s.settings, models: next } } : s,
    );
    client.updateSettings(patch).catch((e: Error) => {
      toast.error("Model setting not saved", { description: e.message });
      void queryClient.invalidateQueries({ queryKey: snapshotKey });
    });
  };
  return { models, current, save };
}

/** Starred models (`models.favorites`), in the order they were starred. */
export function useFavoriteModels(): {
  favorites: ModelRef[];
  toggle: (ref: ModelRef) => void;
} {
  const { models, current, save } = useModelsSettings();
  const toggle = (ref: ModelRef) => {
    const now = current();
    const favorites = toggleFavorite(now.favorites, ref);
    save({ ...now, favorites }, { models: { favorites } });
  };
  return { favorites: models.favorites, toggle };
}

/** Models left out of the picker (`models.hidden`), by provider. */
export function useHiddenModels(): {
  hidden: HiddenModels;
  toggle: (providerId: string, modelId: string) => void;
} {
  const { models, current, save } = useModelsSettings();
  const toggle = (providerId: string, modelId: string) => {
    const now = current();
    const ids = toggleHidden(now.hidden, providerId, modelId);
    save(
      { ...now, hidden: { ...now.hidden, [providerId]: ids } },
      {
        models: { hidden: { [providerId]: ids } },
      },
    );
  };
  return { hidden: models.hidden, toggle };
}
