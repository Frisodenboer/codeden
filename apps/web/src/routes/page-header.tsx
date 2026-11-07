import type { ReactNode } from "react";

/** Top bar of the centre column. */
export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
      <h1 className="text-sm font-medium">{title}</h1>
      {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
      <div className="ml-auto flex items-center gap-1">{actions}</div>
    </header>
  );
}
