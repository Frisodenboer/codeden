import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ClientProvider, type CodeDenClient } from "@/lib/api";
import { createMockClient } from "@/lib/api/mock";

/**
 * Render with the client, query and tooltip providers the app uses. `withRouter` mounts the
 * element inside a memory router for components that render links (use `findBy*` queries).
 */
export function renderWithClient(
  ui: ReactElement,
  client: CodeDenClient = createMockClient(),
  opts: { withRouter?: boolean } = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const content = opts.withRouter ? (
    <RouterProvider
      router={createRouter({
        routeTree: createRootRoute({ component: () => ui }),
        history: createMemoryHistory({ initialEntries: ["/"] }),
      })}
    />
  ) : (
    ui
  );
  const result = render(
    <ClientProvider client={client}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>{content}</TooltipProvider>
      </QueryClientProvider>
    </ClientProvider>,
  );
  return { ...result, client, queryClient };
}
