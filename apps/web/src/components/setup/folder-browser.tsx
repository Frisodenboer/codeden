import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ChevronRight, Folder, FolderGit2, Home } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Server-side directory browser (§13): browsers can't return real paths, so the server lists
 * folders and the user picks one. Works the same for remote use later.
 */
export function FolderBrowser({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (path: string) => void;
}) {
  const client = useClient();
  const [path, setPath] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["fs", path, showHidden],
    queryFn: () => client.listDirectory(path, { showHidden }),
    placeholderData: (prev) => prev,
  });
  const current = data?.path ?? "";
  const crumbs = current.split(/[\\/]/).filter(Boolean);
  const sep = current.includes("\\") || /^[A-Za-z]:/.test(current) ? "\\" : "/";
  const entries = (data?.entries ?? []).filter((e) => showHidden || !e.hidden);
  const places = data
    ? [
        { label: "Home", path: data.home },
        ...data.roots.map((r) => ({ label: r.name, path: r.path })),
      ]
    : [];

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
        <Button
          variant="ghost"
          size="icon-xs"
          disabled={!data?.parent}
          onClick={() => data?.parent && setPath(data.parent)}
          aria-label="Up one folder"
        >
          <ArrowUp />
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto font-mono text-2xs text-muted-foreground scroll-thin">
          {crumbs.map((c, i) => {
            const target = crumbs.slice(0, i + 1).join(sep) + (i === 0 && sep === "\\" ? "\\" : "");
            return (
              <span key={target} className="flex shrink-0 items-center gap-0.5">
                {i > 0 && <ChevronRight className="size-3 opacity-50" />}
                <button
                  type="button"
                  className="rounded px-1 hover:bg-accent hover:text-foreground"
                  onClick={() =>
                    setPath(sep === "/" ? `/${target}` : target.replace(/\\$/, i === 0 ? "\\" : ""))
                  }
                >
                  {c}
                </button>
              </span>
            );
          })}
        </div>
        <label className="flex shrink-0 items-center gap-1 text-3xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            className="accent-primary"
          />{" "}
          hidden
        </label>
      </div>
      <div className="flex">
        <div className="w-32 shrink-0 space-y-0.5 border-r border-border p-1.5">
          {places.map((p) => (
            <button
              key={p.path}
              type="button"
              onClick={() => setPath(p.path)}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground",
                current === p.path && "bg-accent text-foreground",
              )}
            >
              <Home className="size-3" /> {p.label}
            </button>
          ))}
        </div>
        <div className="h-64 min-w-0 flex-1 overflow-y-auto p-1 scroll-thin">
          {isLoading && (
            <div className="space-y-1.5 p-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-5" />
              ))}
            </div>
          )}
          {error && (
            <div className="p-3 text-xs text-status-failed">{(error as Error).message}</div>
          )}
          {!isLoading && !error && entries.length === 0 && (
            <div className="p-3 text-xs text-muted-foreground">No folders here.</div>
          )}
          {entries.map((e) => (
            <div
              key={e.path}
              className={cn(
                "group flex h-8 w-full items-center rounded-md text-[13px] hover:bg-accent/70",
                value === e.path && "bg-primary/10 ring-1 ring-primary/40",
              )}
            >
              <button
                type="button"
                onClick={() => onChange(e.path)}
                onDoubleClick={() => setPath(e.path)}
                className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left"
              >
                {e.isGitRepo ? (
                  <FolderGit2 className="size-4 shrink-0 text-primary" />
                ) : (
                  <Folder className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="flex-1 truncate">{e.name}</span>
                {e.isGitRepo && (
                  <span className="rounded bg-muted px-1.5 text-3xs text-muted-foreground">
                    git
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => setPath(e.path)}
                className="mr-1 flex size-6 shrink-0 items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-background focus-visible:opacity-100"
                aria-label={`Open ${e.name}`}
              >
                <ChevronRight className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
      <form
        className="border-t border-border bg-muted/30"
        onSubmit={(e) => {
          e.preventDefault();
          const next = typed?.trim();
          if (!next) return;
          setPath(next);
          onChange(next);
          setTyped(null);
        }}
      >
        <input
          value={typed ?? value ?? ""}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="Select a folder · double-click to open · or paste a path and press Enter"
          aria-label="Folder path"
          className="w-full bg-transparent px-3 py-1.5 font-mono text-2xs text-muted-foreground outline-none placeholder:text-muted-foreground/70 focus:text-foreground"
        />
      </form>
    </div>
  );
}
