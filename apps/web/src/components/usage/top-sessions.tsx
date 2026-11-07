import type { UsageSessionRow } from "@codeden/contracts";
import { Link } from "@tanstack/react-router";
import { GitMerge, GitPullRequest } from "lucide-react";
import { ProviderMark } from "@/components/common/bits";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ago } from "@/lib/format";
import { money, tokens } from "./format";

const SOURCE_LABELS: Record<UsageSessionRow["source"], string> = {
  user: "You",
  orchestrator: "Orchestrator",
  pm: "PM",
  automation: "Automation",
  factory: "Factory",
};

/** Sessions ranked by cost, each linking to its transcript. */
export function TopSessionsTable({
  sessions,
  empty = "No sessions in this range.",
  limit = 10,
}: {
  sessions: UsageSessionRow[];
  empty?: string;
  limit?: number;
}) {
  if (sessions.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <Table className="text-xs" data-testid="top-sessions">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-8 text-2xs">Session</TableHead>
          <TableHead className="h-8 text-2xs">Model</TableHead>
          <TableHead className="h-8 text-2xs">Started by</TableHead>
          <TableHead className="h-8 text-right text-2xs">Turns</TableHead>
          <TableHead className="h-8 text-right text-2xs">Tokens</TableHead>
          <TableHead className="h-8 text-right text-2xs">Cost</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sessions.slice(0, limit).map((s) => (
          <TableRow key={s.sessionId}>
            <TableCell className="max-w-80 py-2">
              <Link
                to="/sessions/$sessionId"
                params={{ sessionId: s.sessionId }}
                className="block truncate font-medium hover:underline"
              >
                {s.title}
              </Link>
              <span className="flex items-center gap-1.5 text-2xs text-muted-foreground">
                {s.projectName ?? (s.role === "orchestrator" ? "Orchestrator" : "No project")}
                <span className="text-muted-foreground/50">·</span>
                {ago(s.lastAt)}
                {s.pr && (
                  <span className="inline-flex items-center gap-0.5">
                    <span className="text-muted-foreground/50">·</span>
                    {s.pr.state === "merged" ? (
                      <GitMerge className="size-3 text-status-done" />
                    ) : (
                      <GitPullRequest className="size-3" />
                    )}
                    #{s.pr.number}
                  </span>
                )}
              </span>
            </TableCell>
            <TableCell className="py-2">
              <span className="inline-flex items-center gap-1.5 font-mono text-2xs text-muted-foreground">
                <ProviderMark provider={s.provider} className="size-3.5 text-[8px]" />
                {s.model}
              </span>
            </TableCell>
            <TableCell className="py-2 text-muted-foreground">{SOURCE_LABELS[s.source]}</TableCell>
            <TableCell className="py-2 text-right text-muted-foreground tabular-nums">
              {s.turns}
            </TableCell>
            <TableCell className="py-2 text-right text-muted-foreground tabular-nums">
              {tokens(s.tokens)}
            </TableCell>
            <TableCell className="py-2 text-right font-mono font-medium tabular-nums">
              {money(s.costUsd, s.estimated)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
