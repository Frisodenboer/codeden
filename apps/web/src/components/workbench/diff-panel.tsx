import { PatchDiff } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Columns2, FileDiff, Rows2, WrapText } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/common/bits";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useClient } from "@/lib/api";
import type { DiffScope } from "@/lib/api/types";
import { ageShort } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useResolvedTheme } from "@/stores/theme";

function scopeLabel(scope: DiffScope, turns: { id: string; label: string }[]): string {
  if (scope.kind === "session") return "All changes";
  if (scope.kind === "uncommitted") return "Uncommitted";
  return turns.find((t) => t.id === scope.turnId)?.label ?? "Turn";
}

/** Session and per-turn diffs from checkpoints (§9, §12.3). */
export function DiffPanel({ sessionId }: { sessionId: string }) {
  const client = useClient();
  const theme = useResolvedTheme();
  const [scope, setScope] = useState<DiffScope>({ kind: "session" });
  const [split, setSplit] = useState(false);
  const [wrap, setWrap] = useState(true);
  const { data, isLoading } = useQuery({
    queryKey: ["diff", sessionId, scope],
    queryFn: () => client.getDiff(sessionId, scope),
  });
  const files = data?.files ?? [];
  const add = files.reduce((n, f) => n + f.additions, 0);
  const del = files.reduce((n, f) => n + f.deletions, 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1 text-xs">
              {scopeLabel(scope, data?.turns ?? [])}
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuItem onSelect={() => setScope({ kind: "session" })}>
              All changes in this session
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setScope({ kind: "uncommitted" })}>
              Uncommitted
            </DropdownMenuItem>
            {(data?.turns.length ?? 0) > 0 && <DropdownMenuSeparator />}
            {(data?.turns.length ?? 0) > 0 && (
              <DropdownMenuLabel className="text-2xs">By turn</DropdownMenuLabel>
            )}
            {[...(data?.turns ?? [])].reverse().map((t) => (
              <DropdownMenuItem
                key={t.id}
                onSelect={() => setScope({ kind: "turn", turnId: t.id })}
              >
                <span className="flex-1">{t.label}</span>
                <span className="text-2xs text-muted-foreground">{ageShort(t.at)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {files.length > 0 && (
          <span className="text-2xs text-muted-foreground tabular-nums">
            {files.length} files · <span className="text-diff-add">+{add}</span>{" "}
            <span className="text-diff-del">−{del}</span>
          </span>
        )}
        <div className="ml-auto flex items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn("text-muted-foreground", wrap && "text-foreground")}
            onClick={() => setWrap((v) => !v)}
            aria-label="Toggle wrap"
            title="Wrap lines"
          >
            <WrapText />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            onClick={() => setSplit((v) => !v)}
            aria-label="Toggle split view"
            title={split ? "Unified" : "Split"}
          >
            {split ? <Rows2 /> : <Columns2 />}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-thin">
        {isLoading ? (
          <div className="space-y-2 p-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : files.length === 0 ? (
          <EmptyState icon={<FileDiff />} title="No changes yet" className="h-full">
            Diffs appear here from the session's turn checkpoints.
          </EmptyState>
        ) : (
          <div className="space-y-3 p-2">
            {files.map((f) => (
              <div key={f.path} className="overflow-hidden rounded-lg border border-border">
                <PatchDiff
                  patch={f.patch}
                  options={{
                    theme: { dark: "pierre-dark", light: "pierre-light" },
                    themeType: theme,
                    diffStyle: split ? "split" : "unified",
                    overflow: wrap ? "wrap" : "scroll",
                    stickyHeader: true,
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
