import type { AutonomyLevel } from "@codeden/contracts";
import { AlertTriangle } from "lucide-react";
import { AUTONOMY, AUTONOMY_LEVELS } from "@/components/thread/autonomy";
import { cn } from "@/lib/utils";

/**
 * Permissions of the sessions an automation starts (§11.2), as the ladder Read-only ->
 * Supervised -> Auto -> Full with one plain line each. Read-only is disabled when the chosen
 * provider cannot enforce it.
 */
export function PermissionsField({
  value,
  onChange,
  disabled,
  readOnlySupported = true,
}: {
  value: AutonomyLevel;
  onChange: (v: AutonomyLevel) => void;
  disabled?: boolean;
  readOnlySupported?: boolean;
}) {
  return (
    <div className="space-y-2">
      <fieldset
        aria-label="Permissions"
        className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="permissions-field"
      >
        {AUTONOMY_LEVELS.map((level) => {
          const o = AUTONOMY[level];
          const unavailable = level === "read_only" && !readOnlySupported;
          const selected = level === value;
          return (
            <button
              key={level}
              type="button"
              aria-pressed={selected}
              disabled={disabled || unavailable}
              onClick={() => onChange(level)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-primary/40 disabled:pointer-events-none disabled:opacity-55",
                selected && "border-primary/60 bg-primary/[0.06] ring-1 ring-primary/30",
              )}
            >
              <span className="flex items-center gap-1.5 text-[13px] font-medium">
                <o.icon className={cn("size-3.5", o.tone)} /> {o.label}
              </span>
              <span className="text-3xs leading-snug text-muted-foreground">
                {unavailable ? "This provider can't enforce read-only." : o.description}
              </span>
            </button>
          );
        })}
      </fieldset>
      {value === "full" && (
        <p className="flex items-start gap-1.5 text-2xs text-status-waiting">
          <AlertTriangle className="mt-px size-3.5 shrink-0" />
          Full never asks before acting, even unattended. Use it only for work you trust.
        </p>
      )}
    </div>
  );
}
