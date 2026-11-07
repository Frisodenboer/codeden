import type { Session } from "@codeden/contracts";
import { useQuery } from "@tanstack/react-query";
import { Brain, FileText, Plug, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { ProviderMark } from "@/components/common/bits";
import { AutonomyBadge } from "@/components/thread/autonomy";
import { useClient } from "@/lib/api";
import { ago, compact, statusLabel, usd } from "@/lib/format";
import { useTranscriptsStore } from "@/stores/transcripts";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_1fr] items-baseline gap-3 py-1.5 text-[13px]">
      <span className="text-2xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{children}</span>
    </div>
  );
}

const startedByLabel = {
  user: "You",
  orchestrator: "Orchestrator",
  pm: "Project manager",
  automation: "Automation",
};

/** Session metadata, usage and what's loaded into its context (§8.4, §12.4). */
export function DetailsPanel({ session }: { session: Session }) {
  const client = useClient();
  const usage = useTranscriptsStore((s) => s.byId[session.id]?.usage ?? null);
  const loaded = useQuery({
    queryKey: ["loaded", session.id],
    queryFn: () => client.getLoadedContext(session.id),
  });
  const ctxPct =
    usage?.contextTokens && usage.contextWindow
      ? (usage.contextTokens / usage.contextWindow) * 100
      : 34;

  return (
    <div className="h-full space-y-5 overflow-y-auto p-4 scroll-thin">
      <section className="divide-y divide-border/60">
        <Row label="Status">
          {statusLabel[session.status]}
          {session.progress && (
            <span className="block text-2xs text-muted-foreground">{session.progress.text}</span>
          )}
        </Row>
        <Row label="Purpose">{session.purpose}</Row>
        <Row label="Work key">
          <code className="font-mono text-[12px]">{session.workKey}</code>
        </Row>
        <Row label="Started by">
          {startedByLabel[session.startedBy.kind]} · {ago(session.createdAt)}
        </Row>
        <Row label="Provider">
          <span className="inline-flex items-center gap-1.5">
            <ProviderMark provider={session.provider} /> {session.provider} ·{" "}
            {session.model ?? "default"}
            {session.effort ? ` · ${session.effort}` : ""}
          </span>
        </Row>
        <Row label="Autonomy">
          <AutonomyBadge level={session.autonomy} />
        </Row>
        {session.branch && (
          <Row label="Branch">
            <code className="font-mono text-[12px]">{session.branch}</code>{" "}
            <span className="text-2xs text-muted-foreground">from {session.baseBranch}</span>
          </Row>
        )}
        {session.worktreePath && (
          <Row label="Worktree">
            <code className="font-mono text-[11.5px] text-muted-foreground">
              {session.worktreePath}
            </code>
          </Row>
        )}
        {session.scope.paths && (
          <Row label="Scope">
            <code className="font-mono text-[12px]">{session.scope.paths.join(", ")}</code>
          </Row>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
          Context window
        </h3>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${ctxPct}%` }} />
        </div>
        <div className="flex justify-between text-2xs text-muted-foreground tabular-nums">
          <span>
            {usage?.contextTokens ? compact(usage.contextTokens) : "68k"} /{" "}
            {usage?.contextWindow ? compact(usage.contextWindow) : "200k"} tokens
          </span>
          <span>{usage?.costUsd !== undefined ? usd(usage.costUsd) : "$1.84"} this session</span>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
          What's loaded
        </h3>
        <LoadedList icon={<FileText />} title="Memory" items={loaded.data?.memory ?? []} />
        <LoadedList icon={<Sparkles />} title="Skills" items={loaded.data?.skills ?? []} />
        <LoadedList icon={<Plug />} title="MCP servers" items={loaded.data?.mcpServers ?? []} />
      </section>
      <p className="flex items-center gap-1.5 text-3xs text-muted-foreground/70">
        <Brain className="size-3" /> Session {session.id} · resumable
        {session.resumeToken ? "" : " after first turn"}
      </p>
    </div>
  );
}

function LoadedList({ icon, title, items }: { icon: ReactNode; title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-2xs text-muted-foreground [&_svg]:size-3.5">
        {icon} {title} <span className="ml-auto tabular-nums">{items.length}</span>
      </div>
      <div className="px-3 py-1.5">
        {items.map((i) => (
          <div key={i} className="truncate py-0.5 font-mono text-[11.5px] text-foreground/80">
            {i}
          </div>
        ))}
      </div>
    </div>
  );
}
