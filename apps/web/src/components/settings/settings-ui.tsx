import { defaultSettings, type Settings, type SettingsPatch } from "@codeden/contracts";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { useClient } from "@/lib/api";
import { useSnapshotData } from "@/lib/queries";
import { cn } from "@/lib/utils";

const fallback = defaultSettings();

/** Current settings plus a patch function (validated server-side by re-parsing). */
export function useSettings(): { settings: Settings; update: (patch: SettingsPatch) => void } {
  const client = useClient();
  const settings = useSnapshotData((s) => s.settings, fallback);
  const m = useMutation({
    mutationFn: (patch: SettingsPatch) => client.updateSettings(patch),
    onError: (e) => toast.error("Setting not saved", { description: e.message }),
  });
  return { settings, update: (patch) => m.mutate(patch) };
}

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-10">
      <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
      {description && <p className="mt-1 text-[13px] text-muted-foreground">{description}</p>}
      <div className="mt-4 divide-y divide-border rounded-xl border border-border bg-card">
        {children}
      </div>
    </section>
  );
}

/** Label + help on the left, control on the right. */
export function SettingRow({
  label,
  help,
  children,
  stacked = false,
}: {
  label: string;
  help?: ReactNode;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        "gap-4 px-4 py-3.5",
        stacked ? "space-y-3" : "flex items-center justify-between",
      )}
    >
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium">{label}</div>
        {help && (
          <div className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">{help}</div>
        )}
      </div>
      <div className={cn(!stacked && "shrink-0")}>{children}</div>
    </div>
  );
}

/** Compact segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex h-8 items-center rounded-lg border border-border bg-background/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-full rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
            value === o.value && "bg-accent text-foreground shadow-xs",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
