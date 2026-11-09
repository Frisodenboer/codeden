import { Link, type LinkProps, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const rowBase =
  "group/row relative flex h-8 pointer-coarse:h-10 w-full min-w-0 items-center gap-2 rounded-md px-2 text-[13px] text-sidebar-foreground/80 outline-none transition-colors hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring";
export const rowActive =
  "bg-sidebar-accent text-sidebar-accent-foreground before:absolute before:inset-y-1.5 before:-left-[5px] before:w-[3px] before:rounded-full before:bg-primary";

/**
 * The rows under a project (PM, sessions, automations, archived): a guide line drawn under the
 * project's chevron, with the rows a little to its right.
 */
export const childGroup = "ml-3.5 flex flex-col gap-px border-l border-sidebar-foreground/15 pl-1";
/**
 * A row inside `childGroup`: its icon sits past the project tile, and the selected-row accent
 * bar lands on the guide line.
 */
export const childRow = "pl-5 before:-left-[6px]";
/** A nested group inside a child row's group (automation items): its guide sits under the icon. */
export const grandchildGroup =
  "ml-6.5 flex flex-col gap-px border-l border-sidebar-foreground/15 pl-1";

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
