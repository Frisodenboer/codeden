import { Link, type LinkProps, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const rowBase =
  "group/row relative flex h-8 pointer-coarse:h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground/80 outline-none transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";
export const rowActive =
  "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:-left-[5px] before:w-[3px] before:rounded-full before:bg-primary";

/** True when `href` is the current path. */
export function useIsActive(href: string, exact = true): boolean {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return exact ? pathname === href : pathname.startsWith(href);
}

/** A sidebar row that links somewhere, with the selected-row accent bar. */
export function NavRow({
  href,
  link,
  children,
  className,
  exact = true,
  title,
}: {
  href: string;
  link: LinkProps;
  children: ReactNode;
  className?: string;
  exact?: boolean;
  title?: string;
}) {
  const active = useIsActive(href, exact);
  return (
    <Link {...link} title={title} className={cn(rowBase, active && rowActive, className)}>
      {children}
    </Link>
  );
}
