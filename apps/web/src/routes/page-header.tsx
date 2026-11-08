import type { ReactNode } from "react";
import { MobileNavButton } from "@/components/shell/mobile-nav";

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
    <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border px-4 py-1.5 sm:h-12 sm:flex-nowrap sm:px-5 sm:py-0">
      <MobileNavButton />
      {icon && <span className="text-muted-foreground [&_svg]:size-4">{icon}</span>}
      <h1 className="min-w-[5rem] flex-1 truncate text-[14px] font-medium sm:flex-none">{title}</h1>
      {meta && (
        <div className="hidden truncate text-2xs text-muted-foreground sm:block">{meta}</div>
      )}
      {actions && (
        <div className="ml-auto flex max-w-full shrink-0 items-center gap-1.5 overflow-x-auto">
          {actions}
        </div>
      )}
    </header>
  );
}
