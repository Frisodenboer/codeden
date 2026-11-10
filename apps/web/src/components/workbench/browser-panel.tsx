import type { BrowserInput } from "@codeden/contracts";
import { Globe, Loader2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { EmptyState } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { BrowserCanvas } from "./browser/browser-canvas";
import { BrowserToolbar, DevServerMenu } from "./browser/browser-toolbar";
import { usePanelViewport, type ViewportMode } from "./browser/use-panel-viewport";
import { type SessionBrowser, useSessionBrowser } from "./browser/use-session-browser";

/**
 * The browser the agents drive (§12.2), streamed as screencast frames edge to edge. The page
 * is laid out at the panel's own size, and clicks, keys and scrolling always go to it.
 */
export function BrowserPanel({ sessionId }: { sessionId: string }) {
  const browser = useSessionBrowser(sessionId);
  const [mode, setMode] = useState<ViewportMode>("fit");
  const channel = browser.channel;
  const onInput = useCallback((input: BrowserInput) => channel?.input(input), [channel]);
  // Re-registering as a viewer makes the runner send its current picture.
  const onStall = useCallback(() => channel?.watch(), [channel]);
  const measure = usePanelViewport(channel, mode, browser.viewport?.mine);

  if (browser.open === false) return <ClosedState sessionId={sessionId} browser={browser} />;
  if (browser.open === null) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" />
        {browser.connection === "closed"
          ? "Reconnecting to the session browser…"
          : "Connecting to the session browser…"}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" data-testid="browser-panel">
      <BrowserToolbar
        sessionId={sessionId}
        browser={browser}
        viewportMode={mode}
        onViewportMode={setMode}
      />
      <BrowserTabs sessionId={sessionId} browser={browser} />
      <div
        ref={measure}
        data-testid="browser-viewport"
        data-viewport={
          browser.viewport
            ? `${browser.viewport.width}x${browser.viewport.height}@${browser.viewport.deviceScaleFactor}`
            : undefined
        }
        className="relative min-h-0 flex-1 overflow-hidden bg-background"
      >
        <BrowserCanvas
          onFrame={browser.onFrame}
          onInput={onInput}
          onStall={onStall}
          // Fill only when the page follows this panel; a preset or another viewer's size is
          // fitted inside instead of stretched.
          fit={mode === "fit" && browser.viewport?.mine ? "fill" : "contain"}
          title={browser.activeTab?.title || "Session browser"}
        />
      </div>
    </div>
  );
}

function BrowserTabs({ sessionId, browser }: { sessionId: string; browser: SessionBrowser }) {
  const client = useClient();
  if (browser.tabs.length < 2) return null;
  return (
    <div
      className="flex h-8 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-border px-2 scroll-thin"
      role="tablist"
      aria-label="Browser tabs"
    >
      {browser.tabs.map((t) => (
        <div
          key={t.tabId}
          className={cn(
            "group flex h-7 max-w-44 min-w-0 items-center gap-1 rounded-t-md border border-b-0 px-2 text-2xs",
            t.active
              ? "border-border bg-background text-foreground"
              : "border-transparent text-muted-foreground hover:bg-accent/50",
          )}
        >
          <button
            type="button"
            role="tab"
            aria-selected={t.active}
            onClick={() =>
              void browser.run("Couldn't switch tabs", () =>
                client.browser.activateTab(sessionId, t.tabId),
              )
            }
            className="min-w-0 flex-1 truncate text-left"
            title={t.url}
          >
            {t.title || t.url}
          </button>
          <button
            type="button"
            aria-label={`Close ${t.title || t.url}`}
            onClick={() =>
              void browser.run("Couldn't close the tab", () =>
                client.browser.closeTab(sessionId, t.tabId),
              )
            }
            className="rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-accent touch:opacity-100"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ClosedState({ sessionId, browser }: { sessionId: string; browser: SessionBrowser }) {
  return (
    <div className="flex h-full items-center justify-center" data-testid="browser-closed">
      <EmptyState
        icon={<Globe />}
        title="The session browser is closed"
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => void browser.openBrowser()}>
              <Globe /> Open browser
            </Button>
            <DevServerMenu sessionId={sessionId} browser={browser} variant="button" />
          </div>
        }
      >
        It opens on its own when the agent uses a browser tool. Open it yourself to look at a dev
        server, and the agent will see the same page.
      </EmptyState>
    </div>
  );
}
