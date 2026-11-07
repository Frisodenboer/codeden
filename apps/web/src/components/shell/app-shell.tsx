import { Outlet, useParams, useRouterState } from "@tanstack/react-router";
import { AddProjectDialog } from "@/components/setup/add-project-dialog";
import { RightPanel } from "@/components/workbench/right-panel";
import { TerminalDrawer } from "@/components/workbench/terminal-drawer";
import { useOrchestratorSession } from "@/lib/queries";
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

/** Sidebar · centre · right panel, with resizable dividers and an optional terminal drawer (§13). */
export function AppShell() {
  const layout = useLayoutStore();
  const sessionId = useCurrentSessionId();
  useGlobalShortcuts();

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

      {sessionId && layout.rightOpen && (
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
