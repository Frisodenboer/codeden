import type { AgentConfigFile } from "@codeden/contracts";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Bot, FileText, Plug, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { useClient } from "@/lib/api";

interface Row {
  key: string;
  label: string;
  detail?: string;
  title?: string;
}

const fileRow = (f: AgentConfigFile): Row => ({
  key: f.absolutePath,
  label: f.kind === "skill" || f.kind === "subagent" ? f.name : f.path,
  detail: `${f.scope}${f.onDemand ? " · on demand" : ""}`,
  title: f.absolutePath,
});

/** What the session's provider loads into its context from its working directory (§12.4). */
export function LoadedConfig({
  sessionId,
  projectId,
}: {
  sessionId: string;
  projectId: string | null;
}) {
  const client = useClient();
  const loaded = useQuery({
    queryKey: ["agent-config-loaded", sessionId],
    queryFn: () => client.agentConfig.loaded(sessionId),
  });
  const d = loaded.data;
  return (
    <section className="space-y-2" data-testid="loaded-config">
      <div className="flex items-baseline justify-between">
        <h3 className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
          What's loaded
        </h3>
        <Link
          to="/agents"
          search={{ tab: "memory", project: projectId ?? "global" }}
          className="text-3xs text-muted-foreground hover:text-foreground"
        >
          Edit configuration
        </Link>
      </div>
      {loaded.error && (
        <p className="text-2xs text-status-failed">{(loaded.error as Error).message}</p>
      )}
      {d && (
        <p className="truncate font-mono text-3xs text-muted-foreground" title={d.cwd}>
          {d.provider} · from {d.cwd}
        </p>
      )}
      <LoadedList
        icon={<FileText />}
        title="Memory"
        loading={loaded.isLoading}
        rows={(d?.memory ?? []).map(fileRow)}
      />
      <LoadedList
        icon={<Sparkles />}
        title="Skills"
        loading={loaded.isLoading}
        rows={(d?.skills ?? []).map((s) => ({
          ...fileRow(s.file),
          label: s.name,
          detail: s.scope,
        }))}
      />
      <LoadedList
        icon={<Bot />}
        title="Subagents"
        loading={loaded.isLoading}
        rows={(d?.subagents ?? []).map(fileRow)}
      />
      <LoadedList
        icon={<Plug />}
        title="MCP servers"
        loading={loaded.isLoading}
        rows={(d?.mcpServers ?? []).map((m) => ({
          key: `${m.provider}:${m.scope}:${m.name}`,
          label: m.name,
          detail: m.provider === "codeden" ? "built in" : m.scope,
          title: m.file,
        }))}
      />
    </section>
  );
}

function LoadedList({
  icon,
  title,
  rows,
  loading,
}: {
  icon: ReactNode;
  title: string;
  rows: Row[];
  loading: boolean;
}) {
  return (
    <div className="rounded-lg border border-border">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-2xs text-muted-foreground [&_svg]:size-3.5">
        {icon} {title} <span className="ml-auto tabular-nums">{loading ? "…" : rows.length}</span>
      </div>
      <div className="px-3 py-1.5">
        {!loading && rows.length === 0 && (
          <div className="py-0.5 text-[11.5px] text-muted-foreground">None</div>
        )}
        {rows.map((r) => (
          <div key={r.key} className="flex items-baseline gap-2 py-0.5" title={r.title}>
            <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground/80">
              {r.label}
            </span>
            {r.detail && (
              <span className="shrink-0 text-3xs text-muted-foreground">{r.detail}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
