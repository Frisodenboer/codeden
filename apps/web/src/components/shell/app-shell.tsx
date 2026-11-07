import { Outlet, useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { AddProjectDialog } from "@/components/setup/add-project-dialog";
import { RightPanel } from "@/components/workbench/right-panel";
import { TerminalDrawer } from "@/components/workbench/terminal-drawer";
import { useOrchestratorSession, useSession, useSnapshot } from "@/lib/queries";
import { DRAWER, RIGHT, SIDEBAR, useLayoutStore } from "@/stores/layout";
import { CommandPalette } from "./command-palette";
import { LiveEffects } from "./live-effects";
import { ResizeHandle } from "./resize-handle";
import { ShortcutsDialog, useGlobalShortcuts } from "./shortcuts";
import { Sidebar } from "./sidebar/sidebar";
import { SidebarRail } from "./sidebar/sidebar-rail";

/** The session shown in the centre, if the current route is a thread. */
export function useCurrentSessionId(): string | undefined {
  const params = useParams({ strict: false }) as { sessionId?: string };
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const orchestrator = useOrchestratorSession();
  if (params.sessionId) return params.sessionId;
  if (pathname === "/") return orchestrator?.id;
  return undefined;
}

/** Send a fresh install to the first-run checklist (§14) once, from the home route. */
function useFirstRunRedirect() {
  const { data } = useSnapshot();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const pending = data ? !data.settings.setup.completed : false;
  useEffect(() => {
    if (pending && pathname === "/") void navigate({ to: "/setup" });
  }, [pending, pathname, navigate]);
}

/** Sidebar · centre · right panel, with resizable dividers and an optional terminal drawer (§13). */
export function AppShell() {
  const layout = useLayoutStore();
  const sessionId = useCurrentSessionId();
  // The workbench panel belongs to sessions that own a worktree.
  const hasWorkbench = Boolean(useSession(sessionId)?.worktreePath);
  useGlobalShortcuts();
  useFirstRunRedirect();

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      {layout.sidebarCollapsed ? <SidebarRail /> : <Sidebar width={layout.sidebarWidth} />}
      {!layout.sidebarCollapsed ? (
        <ResizeHandle
          label="Resize sidebar"
          value={layout.sidebarWidth}
          direction={1}
          onResize={layout.setSidebarWidth}
          onReset={() => layout.setSidebarWidth(SIDEBAR.default)}
          className="bg-sidebar-border"
        />
      ) : (
        <div className="w-px shrink-0 bg-sidebar-border" />
      )}

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </div>
        {layout.drawerOpen && (
          <>
            <ResizeHandle
              orientation="horizontal"
              label="Resize terminal"
              value={layout.drawerHeight}
              direction={-1}
              onResize={layout.setDrawerHeight}
              onReset={() => layout.setDrawerHeight(DRAWER.default)}
            />
            <div style={{ height: layout.drawerHeight }} className="shrink-0">
              <TerminalDrawer sessionId={sessionId ?? null} />
            </div>
          </>
        )}
      </main>

      {sessionId && hasWorkbench && layout.rightOpen && (
        <>
          <ResizeHandle
            label="Resize panel"
            value={layout.rightWidth}
            direction={-1}
            onResize={layout.setRightWidth}
            onReset={() => layout.setRightWidth(RIGHT.default)}
          />
          <RightPanel sessionId={sessionId} width={layout.rightWidth} />
        </>
      )}

      <CommandPalette />
      <AddProjectDialog />
      <ShortcutsDialog />
      <LiveEffects />
    </div>
  );
}
