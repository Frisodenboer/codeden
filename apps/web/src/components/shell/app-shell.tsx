import { Outlet } from "@tanstack/react-router";
import { RightPanel } from "./right-panel";
import { Sidebar } from "./sidebar";

/** Three-column app shell: sidebar · centre · right panel (§13). */
export function AppShell() {
  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <Sidebar />
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
      <RightPanel />
    </div>
  );
}
