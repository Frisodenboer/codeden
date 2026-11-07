import { useMutation, useQuery } from "@tanstack/react-query";
import { Bot, Plug, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ProviderMark } from "@/components/common/bits";
import { StatusDot } from "@/components/common/status-dot";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useClient } from "@/lib/api";

function Shell({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          <p className="text-[13px] text-muted-foreground">{description}</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => toast("Opens the editor with a template (mock)")}
        >
          <Plus /> {action}
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">{children}</div>
    </div>
  );
}

const scopeChip =
  "rounded-full border border-border px-1.5 py-px text-3xs capitalize text-muted-foreground";

export function SkillsList({ projectId }: { projectId: string | null }) {
  const client = useClient();
  const { data, isLoading, refetch } = useQuery({
    queryKey: ["skills", projectId],
    queryFn: () => client.listSkills(projectId),
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; enabled: boolean }) => client.setSkillEnabled(v.id, v.enabled),
    onSuccess: () => void refetch(),
  });
  return (
    <Shell
      title="Skills"
      description="Each provider's user and project skill folders."
      action="New skill"
    >
      {isLoading && <Skeleton className="m-3 h-10" />}
      {data?.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
        >
          <Sparkles className="size-4 shrink-0 text-primary/80" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13.5px] font-medium">
              {s.name} <span className={scopeChip}>{s.scope}</span>
            </div>
            <div className="truncate text-2xs text-muted-foreground">{s.description}</div>
            <div className="truncate font-mono text-3xs text-muted-foreground/70">{s.path}</div>
          </div>
          <ProviderMark provider={s.provider} />
          <Switch
            checked={s.enabled}
            onCheckedChange={(enabled) => toggle.mutate({ id: s.id, enabled })}
            aria-label={`Enable ${s.name}`}
          />
        </div>
      ))}
    </Shell>
  );
}

export function SubagentsList({ projectId }: { projectId: string | null }) {
  const client = useClient();
  const { data, isLoading } = useQuery({
    queryKey: ["subagents", projectId],
    queryFn: () => client.listSubagents(projectId),
  });
  return (
    <Shell
      title="Subagents"
      description=".claude/agents/ and ~/.claude/agents/, plus equivalents where providers have them."
      action="New subagent"
    >
      {isLoading && <Skeleton className="m-3 h-10" />}
      {data?.map((a) => (
        <div
          key={a.id}
          className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-chart-4/12 text-chart-4">
            <Bot className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 font-mono text-[13px]">
              {a.name} <span className={scopeChip}>{a.scope}</span>
            </div>
            <div className="truncate text-2xs text-muted-foreground">{a.description}</div>
          </div>
          <div className="hidden flex-wrap justify-end gap-1 md:flex">
            {a.tools.map((t) => (
              <span
                key={t}
                className="rounded bg-muted px-1.5 py-px font-mono text-3xs text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
          <span className="w-16 text-right text-2xs text-muted-foreground">
            {a.model ?? "inherit"}
          </span>
        </div>
      ))}
    </Shell>
  );
}

export function McpList({ projectId }: { projectId: string | null }) {
  const client = useClient();
  const { data, isLoading } = useQuery({
    queryKey: ["mcp", projectId],
    queryFn: () => client.listMcpServers(projectId),
  });
  const [testing, setTesting] = useState<string | null>(null);
  const test = useMutation({
    mutationFn: (id: string) => client.testMcpServer(id),
    onMutate: (id) => setTesting(id),
    onSettled: () => setTesting(null),
    onSuccess: (r) => (r.ok ? toast.success(r.message) : toast.error(r.message)),
  });
  return (
    <Shell
      title="MCP servers"
      description=".mcp.json, Claude user config and ~/.codex/config.toml — enabled per provider."
      action="Add server"
    >
      {isLoading && <Skeleton className="m-3 h-10" />}
      {data?.map((s) => (
        <div
          key={s.id}
          className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-0"
        >
          <Plug className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[13.5px] font-medium">
              <StatusDot
                tone={s.status === "connected" ? "done" : s.status === "error" ? "failed" : "idle"}
              />
              {s.name}
              <span className="rounded bg-muted px-1.5 py-px font-mono text-3xs font-normal text-muted-foreground">
                {s.transport}
              </span>
              {s.toolCount !== null && (
                <span className="text-3xs font-normal text-muted-foreground">
                  {s.toolCount} tools
                </span>
              )}
            </div>
            <div className="truncate font-mono text-3xs text-muted-foreground">{s.target}</div>
            <div className="text-3xs text-muted-foreground/70">from {s.source}</div>
          </div>
          <div className="flex gap-1">
            {s.enabledFor.map((p) => (
              <ProviderMark key={p} provider={p} className="size-5" />
            ))}
          </div>
          <Button
            size="xs"
            variant="outline"
            onClick={() => test.mutate(s.id)}
            disabled={testing === s.id}
          >
            {testing === s.id ? "Testing…" : "Test"}
          </Button>
        </div>
      ))}
    </Shell>
  );
}
