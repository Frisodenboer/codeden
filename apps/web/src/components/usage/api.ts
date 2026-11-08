import {
  BudgetsResponse,
  ProjectSpend,
  RateLimitsResponse,
  SessionUsage,
  type UsageQuery,
  UsageReport,
  type UsageSettings,
  UsageSettingsResponse,
} from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { serverOrigin, useClient } from "@/lib/api";
import { createFetcher } from "@/lib/api/http";
import { useConnectionStore } from "@/stores/connection";
import { mockUsageApi } from "./mock-data";

/** The `/api/usage` endpoints (§12.6). */
export interface UsageApi {
  report(q: UsageQuery): Promise<UsageReport>;
  session(sessionId: string): Promise<SessionUsage>;
  project(projectId: string): Promise<ProjectSpend>;
  limits(): Promise<RateLimitsResponse>;
  budgets(): Promise<BudgetsResponse>;
  settings(): Promise<UsageSettingsResponse>;
  saveSettings(settings: UsageSettings): Promise<UsageSettingsResponse>;
  /** URL of the CSV export for a query (downloaded by the browser with the auth cookie). */
  csvUrl(q: UsageQuery): string;
}

function queryString(q: UsageQuery): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") params.set(k, String(v));
  return params.toString();
}

export function createHttpUsageApi(origin: string): UsageApi {
  const http = createFetcher(origin, (code) =>
    useConnectionStore.getState().setAuth(code === "sign_in_required" ? "signin" : "unauthorized"),
  );
  const enc = encodeURIComponent;
  return {
    report: (q) => http.get(`/usage/report?${queryString(q)}`, (v) => UsageReport.parse(v)),
    session: (id) => http.get(`/usage/sessions/${enc(id)}`, (v) => SessionUsage.parse(v)),
    project: (id) => http.get(`/usage/projects/${enc(id)}`, (v) => ProjectSpend.parse(v)),
    limits: () => http.get("/usage/limits", (v) => RateLimitsResponse.parse(v)),
    budgets: () => http.get("/usage/budgets", (v) => BudgetsResponse.parse(v)),
    settings: () => http.get("/usage/settings", (v) => UsageSettingsResponse.parse(v)),
    saveSettings: (settings) =>
      http.call("PUT", "/usage/settings", settings, (v) => UsageSettingsResponse.parse(v)),
    csvUrl: (q) => `${origin}/api/usage/export.csv?${queryString(q)}`,
  };
}

let httpApi: UsageApi | undefined;

/** The usage API for the active client (the mock client gets generated sample data). */
export function useUsageApi(): UsageApi {
  const client = useClient();
  if (client.kind === "mock") return mockUsageApi;
  httpApi ??= createHttpUsageApi(serverOrigin);
  return httpApi;
}

export const usageKeys = {
  all: ["usage"] as const,
  report: (q: UsageQuery) => ["usage", "report", q] as const,
  session: (id: string) => ["usage", "session", id] as const,
  project: (id: string) => ["usage", "project", id] as const,
  limits: ["usage", "limits"] as const,
  budgets: ["usage", "budgets"] as const,
  settings: ["usage", "settings"] as const,
};

export function useUsageReport(q: UsageQuery | null) {
  const api = useUsageApi();
  return useQuery({
    queryKey: q ? usageKeys.report(q) : ["usage", "report", "none"],
    queryFn: () => api.report(q as UsageQuery),
    enabled: q !== null,
    placeholderData: (prev) => prev,
    staleTime: 30_000,
  });
}

export function useSessionUsage(sessionId: string | undefined) {
  const api = useUsageApi();
  return useQuery({
    queryKey: usageKeys.session(sessionId ?? ""),
    queryFn: () => api.session(sessionId ?? ""),
    enabled: Boolean(sessionId),
    staleTime: 10_000,
  });
}

export function useProjectSpend(projectId: string) {
  const api = useUsageApi();
  return useQuery({
    queryKey: usageKeys.project(projectId),
    queryFn: () => api.project(projectId),
    staleTime: 30_000,
  });
}

export function useRateLimits() {
  const api = useUsageApi();
  return useQuery({
    queryKey: usageKeys.limits,
    queryFn: () => api.limits(),
    refetchInterval: 60_000,
  });
}

export function useBudgets() {
  const api = useUsageApi();
  return useQuery({ queryKey: usageKeys.budgets, queryFn: () => api.budgets() });
}

export function useUsageSettings() {
  const api = useUsageApi();
  return useQuery({ queryKey: usageKeys.settings, queryFn: () => api.settings() });
}

/** Save usage settings and refresh everything priced or budgeted from them. */
export function useSaveUsageSettings() {
  const api = useUsageApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (settings: UsageSettings) => api.saveSettings(settings),
    onSuccess: (data) => {
      queryClient.setQueryData(usageKeys.settings, data);
      void queryClient.invalidateQueries({ queryKey: usageKeys.all });
    },
  });
}
