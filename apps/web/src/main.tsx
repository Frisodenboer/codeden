import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ApiRequestError, ClientProvider, createClient } from "@/lib/api";
import { startRealtime } from "@/lib/realtime";
import { router } from "@/router";
import { applyTheme, useThemeStore } from "@/stores/theme";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: false,
      // Client errors (missing route, bad request, no checkpoints yet) won't fix themselves.
      retry: (count, error) =>
        !(error instanceof ApiRequestError && error.status >= 400 && error.status < 500) &&
        count < 2,
    },
  },
});
const client = createClient();

applyTheme(useThemeStore.getState().preference);
useThemeStore.subscribe((s) => applyTheme(s.preference));
startRealtime(client, queryClient);

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <ClientProvider client={client}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={300}>
          <RouterProvider router={router} />
        </TooltipProvider>
      </QueryClientProvider>
    </ClientProvider>
  </StrictMode>,
);
