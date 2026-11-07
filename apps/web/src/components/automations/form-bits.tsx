import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** A labelled form field with optional help text. */
export function Field({
  label,
  htmlFor,
  help,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
      {help && <p className="text-3xs leading-relaxed text-muted-foreground">{help}</p>}
    </div>
  );
}

/** A small segmented control (one choice of a few). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: { id: T; label: string; icon?: ReactNode }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <fieldset
      aria-label={label}
      className="m-0 flex w-fit min-w-0 items-center gap-0.5 rounded-lg border border-border bg-surface p-0.5 text-xs"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          disabled={disabled}
          onClick={() => onChange(o.id)}
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none [&_svg]:size-3.5",
            value === o.id && "bg-card text-foreground shadow-xs",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </fieldset>
  );
}

/** A titled card section of the automation editor. */
export function EditorSection({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <header className="flex items-start gap-3 border-b border-border px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <h2 className="text-[13px] font-medium">{title}</h2>
          {description && <p className="text-3xs text-muted-foreground">{description}</p>}
        </div>
        {aside}
      </header>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}
