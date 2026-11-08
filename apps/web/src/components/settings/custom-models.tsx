import type { ProviderInfo } from "@codeden/contracts";
import { Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import {
  addCustomModel,
  type CustomModels,
  removeCustomModel,
} from "@/components/composer/model-picker/custom";
import { useCustomModels } from "@/components/composer/model-picker/use-model-settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSnapshotData } from "@/lib/queries";
import { SettingRow, SettingsSection } from "./settings-ui";

function ProviderCustomModels({
  provider,
  custom,
  onChange,
}: {
  provider: ProviderInfo;
  custom: CustomModels;
  onChange: (providerId: string, list: CustomModels[string]) => void;
}) {
  const list = custom[provider.id] ?? [];
  const [id, setId] = useState("");
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const result = addCustomModel(list, provider, { id, label });
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onChange(provider.id, result.list);
    setId("");
    setLabel("");
    setError(null);
  };
  return (
    <SettingRow
      label={provider.displayName}
      help={list.length ? `${list.length} custom` : "None yet"}
      stacked
    >
      <div className="space-y-2" data-testid={`custom-models-${provider.id}`}>
        {list.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {list.map((m) => (
              <li
                key={m.id}
                className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-2 text-xs"
              >
                <span>{m.label ?? m.id}</span>
                {m.label && (
                  <span className="font-mono text-2xs text-muted-foreground">{m.id}</span>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${m.label ?? m.id}`}
                  onClick={() => onChange(provider.id, removeCustomModel(list, m.id))}
                  className="rounded text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} className="flex flex-wrap items-center gap-1.5">
          <Input
            value={id}
            onChange={(e) => {
              setId(e.target.value);
              setError(null);
            }}
            placeholder="Model id"
            aria-label={`${provider.displayName} custom model id`}
            aria-invalid={error ? true : undefined}
            className="h-7 w-56 font-mono text-xs"
          />
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (optional)"
            aria-label={`${provider.displayName} custom model label`}
            className="h-7 w-44 text-xs"
          />
          <Button type="submit" variant="outline" size="sm" className="h-7 gap-1 text-xs">
            <Plus className="size-3" aria-hidden />
            Add
          </Button>
        </form>
        {error && (
          <p role="alert" className="text-2xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </SettingRow>
  );
}

/**
 * Model ids the providers don't list, per provider (`settings.models.custom`). The picker shows
 * them, marked Custom, after the listed models; the id is sent to the provider unchanged.
 */
export function CustomModelSettings() {
  const providers = useSnapshotData((s) => s.runner.providers, []);
  const { custom, set } = useCustomModels();
  if (providers.length === 0) return null;
  return (
    <SettingsSection
      title="Custom models"
      description="Add a model id a provider doesn't list yet, such as a new model. It is sent to the provider as is; if the provider doesn't know it, the turn fails with the provider's error. Its effort levels are those of the provider's default model."
    >
      {providers.map((p) => (
        <ProviderCustomModels key={p.id} provider={p} custom={custom} onChange={set} />
      ))}
    </SettingsSection>
  );
}
