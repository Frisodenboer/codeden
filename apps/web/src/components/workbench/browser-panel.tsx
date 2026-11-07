import { ArrowLeft, ArrowRight, Bot, Hand, Lock, RotateCw } from "lucide-react";
import { type FormEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/api";
import type { BrowserChannel, BrowserFrame } from "@/lib/api/types";
import { cn } from "@/lib/utils";

/** The browser the agents drive, streamed as screencast frames, with take-over (§12.2). */
export function BrowserPanel({ sessionId }: { sessionId: string }) {
  const client = useClient();
  const channel = useRef<BrowserChannel | null>(null);
  const [frame, setFrame] = useState<BrowserFrame | null>(null);
  const [url, setUrl] = useState("");
  const [owner, setOwner] = useState<"agent" | "user">("agent");
  const editing = useRef(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const ch = client.openBrowser(sessionId);
    channel.current = ch;
    const off = ch.onFrame((f) => {
      setFrame(f);
      if (!editing.current) setUrl(f.url);
    });
    const offUnavailable = ch.onUnavailable(() => setUnavailable(true));
    return () => {
      off();
      offUnavailable();
      ch.close();
      channel.current = null;
    };
  }, [client, sessionId]);

  const takeOver = (next: "agent" | "user") => {
    setOwner(next);
    channel.current?.setControl(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    editing.current = false;
    channel.current?.navigate(url);
  };
  const click = (e: MouseEvent<HTMLImageElement>) => {
    if (owner !== "user" || !frame) return;
    const rect = e.currentTarget.getBoundingClientRect();
    channel.current?.click(
      ((e.clientX - rect.left) / rect.width) * frame.width,
      ((e.clientY - rect.top) / rect.height) * frame.height,
    );
  };

  return (
    <div className="flex h-full flex-col">
      <form
        onSubmit={submit}
        className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={() => channel.current?.back()}
          aria-label="Back"
        >
          <ArrowLeft />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={() => channel.current?.forward()}
          aria-label="Forward"
        >
          <ArrowRight />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground"
          onClick={() => channel.current?.reload()}
          aria-label="Reload"
        >
          <RotateCw />
        </Button>
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background/60 px-2">
          <Lock className="size-3 shrink-0 text-muted-foreground/70" />
          <input
            value={url}
            onFocus={() => (editing.current = true)}
            onBlur={() => (editing.current = false)}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Address"
            className="min-w-0 flex-1 bg-transparent font-mono text-2xs outline-none"
          />
        </div>
      </form>
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-2xs">
        {owner === "agent" ? (
          <>
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span className="size-1.5 animate-pulse rounded-full bg-status-running" />
              <Bot className="size-3.5" /> Agent is driving
            </span>
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              onClick={() => takeOver("user")}
            >
              <Hand /> Take over
            </Button>
          </>
        ) : (
          <>
            <span className="flex items-center gap-1.5 text-status-waiting">
              <Hand className="size-3.5" /> You have control — the agent is paused
            </span>
            <Button size="xs" className="ml-auto" onClick={() => takeOver("agent")}>
              Hand back
            </Button>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto bg-muted/30 p-3 scroll-thin">
        {frame ? (
          <img
            src={frame.src}
            alt={frame.title}
            onClick={click}
            onKeyDown={() => {}}
            className={cn(
              "w-full rounded-lg border border-border shadow-lg transition-shadow",
              owner === "user" ? "cursor-pointer ring-2 ring-status-waiting/50" : "cursor-default",
            )}
          />
        ) : (
          <div className="mt-20 max-w-xs text-center text-xs text-muted-foreground">
            {unavailable
              ? "The session browser isn't available on this server yet."
              : "Connecting to the session browser…"}
          </div>
        )}
      </div>
    </div>
  );
}
