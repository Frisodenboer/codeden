import { useRouterState } from "@tanstack/react-router";
import { Menu } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useViewport } from "@/lib/viewport";
import { useUiStore } from "@/stores/ui";
import { Sidebar } from "./sidebar/sidebar";

/** Opens the sidebar drawer; shown in page headers on phones and portrait tablets only. */
export function MobileNavButton({ className }: { className?: string }) {
  const { drawerNav } = useViewport();
  const setNavOpen = useUiStore((s) => s.setNavOpen);
  if (!drawerNav) return null;
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("-ml-2 shrink-0 text-muted-foreground", className)}
      onClick={() => setNavOpen(true)}
      aria-label="Open menu"
      data-testid="mobile-nav-button"
    >
      <Menu />
    </Button>
  );
}

/**
 * The full sidebar in a slide-out drawer (phones, tablets). Closes itself when a link is
 * followed, so the page underneath is what you see next.
 */
export function MobileNavDrawer() {
  const open = useUiStore((s) => s.navOpen);
  const setOpen = useUiStore((s) => s.setNavOpen);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on every navigation
  useEffect(() => {
    setOpen(false);
  }, [pathname, setOpen]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="gap-0 border-sidebar-border bg-sidebar p-0 data-[side=left]:w-[min(20rem,88vw)] data-[side=left]:sm:max-w-none"
        data-testid="mobile-nav"
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SheetDescription className="sr-only">Orchestrator, inbox and projects</SheetDescription>
        <Sidebar width="100%" onClose={() => setOpen(false)} />
      </SheetContent>
    </Sheet>
  );
}
