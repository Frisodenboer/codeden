import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { AppShell } from "@/components/shell/app-shell";
import { UnauthorizedScreen } from "@/components/shell/unauthorized";
import { Toaster } from "@/components/ui/sonner";
import { AgentsPage, type AgentTab } from "@/routes/agents";
import { HomePage } from "@/routes/home";
import { InboxPage } from "@/routes/inbox";
import { ProjectPage } from "@/routes/project";
import { ReportsPage } from "@/routes/reports";
import { SessionPage } from "@/routes/session";
import { SettingsPage } from "@/routes/settings";
import { SetupPage } from "@/routes/setup";
import { VisionPage } from "@/routes/vision";
import { useConnectionStore } from "@/stores/connection";

function Root() {
  const auth = useConnectionStore((s) => s.auth);
  if (auth === "unauthorized") return <UnauthorizedScreen />;
  return (
    <>
      <Outlet />
      <Toaster position="bottom-right" />
    </>
  );
}

const rootRoute = createRootRoute({ component: Root });

const shell = createRoute({ getParentRoute: () => rootRoute, id: "shell", component: AppShell });

const sessionRoute = createRoute({
  getParentRoute: () => shell,
  path: "/sessions/$sessionId",
  component: function Session() {
    const { sessionId } = sessionRoute.useParams();
    return <SessionPage sessionId={sessionId} />;
  },
});

const projectRoute = createRoute({
  getParentRoute: () => shell,
  path: "/projects/$projectId",
  validateSearch: (s: Record<string, unknown>): { newSession?: boolean } =>
    s.newSession ? { newSession: true } : {},
  component: function Project() {
    const { projectId } = projectRoute.useParams();
    const { newSession } = projectRoute.useSearch();
    return <ProjectPage key={projectId} projectId={projectId} newSession={Boolean(newSession)} />;
  },
});

const visionRoute = createRoute({
  getParentRoute: () => shell,
  path: "/projects/$projectId/vision",
  component: function Vision() {
    const { projectId } = visionRoute.useParams();
    return <VisionPage projectId={projectId} />;
  },
});

const settingsSectionRoute = createRoute({
  getParentRoute: () => shell,
  path: "/settings/$section",
  component: function Settings() {
    const { section } = settingsSectionRoute.useParams();
    return <SettingsPage section={section} />;
  },
});

const AGENT_TABS: AgentTab[] = ["memory", "skills", "subagents", "mcp"];
const agentsRoute = createRoute({
  getParentRoute: () => shell,
  path: "/agents",
  validateSearch: (s: Record<string, unknown>): { tab?: AgentTab; project?: string } => ({
    tab: AGENT_TABS.includes(s.tab as AgentTab) ? (s.tab as AgentTab) : undefined,
    project: typeof s.project === "string" ? s.project : undefined,
  }),
  component: function Agents() {
    const { tab, project } = agentsRoute.useSearch();
    return <AgentsPage tab={tab ?? "memory"} projectId={project ?? null} />;
  },
});

const reportsRoute = createRoute({
  getParentRoute: () => shell,
  path: "/reports",
  validateSearch: (s: Record<string, unknown>): { project?: string } =>
    typeof s.project === "string" ? { project: s.project } : {},
  component: function Reports() {
    const { project } = reportsRoute.useSearch();
    return <ReportsPage key={project ?? "all"} projectId={project} />;
  },
});

const routeTree = rootRoute.addChildren([
  shell.addChildren([
    createRoute({ getParentRoute: () => shell, path: "/", component: HomePage }),
    createRoute({ getParentRoute: () => shell, path: "/inbox", component: InboxPage }),
    reportsRoute,
    sessionRoute,
    projectRoute,
    visionRoute,
    createRoute({
      getParentRoute: () => shell,
      path: "/settings",
      beforeLoad: () => {
        throw redirect({ to: "/settings/$section", params: { section: "general" } });
      },
    }),
    settingsSectionRoute,
    agentsRoute,
  ]),
  createRoute({ getParentRoute: () => rootRoute, path: "/setup", component: SetupPage }),
]);

export const router = createRouter({ routeTree, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
