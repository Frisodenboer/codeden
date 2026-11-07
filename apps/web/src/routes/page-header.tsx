import type { ReactNode } from "react";

/** Top bar of non-thread pages, matching the thread header height. */
export function PageHeader({
  icon,
  title,
  meta,
  actions,
}: {
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-5">
      {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      <h1 className="text-[14px] font-medium">{title}</h1>
      {meta && <div className="text-2xs text-muted-foreground">{meta}</div>}
      <div className="ml-auto flex items-center gap-1.5">{actions}</div>
    </header>
  );
}
