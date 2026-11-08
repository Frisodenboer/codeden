import {
  type ItemOf,
  NOTICE_BATCH_CODE,
  type Notice,
  NoticeBatchData,
  type NoticeType,
} from "@codeden/contracts";
import { Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  Factory,
  GitMerge,
  GitPullRequest,
  type LucideIcon,
  MessageCircleQuestion,
  MessageSquare,
  MessagesSquare,
  OctagonX,
  SkipForward,
  Swords,
  XCircle,
} from "lucide-react";
import { ProjectTile } from "@/components/shell/sidebar/project-group";
import { ago } from "@/lib/format";
import { platform } from "@/lib/platform";
import { useProject } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** The typed notices of an `orchestration_notices` item, or null for other notices. */
export function noticeBatchOf(item: ItemOf<"notice">): Notice[] | null {
  if (item.code !== NOTICE_BATCH_CODE) return null;
  const parsed = NoticeBatchData.safeParse(item.data);
  return parsed.success ? parsed.data.notices : null;
}

const look: Record<NoticeType, { icon: LucideIcon; tone: string; label: string }> = {
  "session.finished": { icon: CheckCircle2, tone: "text-status-done", label: "Finished" },
  "session.needs_input": {
    icon: MessageCircleQuestion,
    tone: "text-status-waiting",
    label: "Needs input",
  },
  "session.failed": { icon: OctagonX, tone: "text-status-failed", label: "Failed" },
  "pr.opened": { icon: GitPullRequest, tone: "text-status-done", label: "PR opened" },
  "pr.checks_failed": { icon: XCircle, tone: "text-status-failed", label: "Checks failed" },
  "pr.checks_passed": { icon: CheckCircle2, tone: "text-status-done", label: "Checks passed" },
  "pr.merged": { icon: GitMerge, tone: "text-chart-4", label: "Merged" },
  "review.submitted": { icon: MessagesSquare, tone: "text-primary", label: "Review" },
  "issue.opened": { icon: CircleDot, tone: "text-status-done", label: "New issue" },
  "automation.skipped": { icon: SkipForward, tone: "text-muted-foreground", label: "Skipped" },
  "factory.update": { icon: Factory, tone: "text-primary", label: "Factory" },
  conflict: { icon: Swords, tone: "text-chart-5", label: "Conflict" },
  "pm.message": { icon: MessageSquare, tone: "text-primary", label: "From the PM" },
};

/** One line of detail under the title, specific to the notice type. */
function detail(n: Notice): string | null {
  switch (n.type) {
    case "session.finished":
      return n.data.summary ?? n.data.outcome;
    case "session.needs_input":
      return n.data.question;
    case "session.failed":
      return n.data.error;
    case "pr.checks_failed":
      return n.data.failedChecks.length ? `Failed: ${n.data.failedChecks.join(", ")}` : null;
    case "pr.merged":
      return n.data.linkedIssues.length
        ? `Closes ${n.data.linkedIssues.map((i) => `#${i}`).join(", ")}`
        : null;
    case "review.submitted":
      return `${n.data.reviewer ?? "Someone"} ${n.data.state.replace("_", " ")}${n.data.body ? `: ${n.data.body}` : ""}`;
    case "issue.opened":
      return [n.data.author, ...n.data.labels].filter(Boolean).join(" · ") || null;
    case "automation.skipped":
      return n.data.reason;
    case "conflict":
      return `${n.data.existing.length} matching ${n.data.existing.length === 1 ? "run" : "runs"} already going`;
    case "pm.message":
      return n.data.text;
    default:
      return null;
  }
}

/** Where a notice links: the session in CodeDen, and the PR or issue on GitHub. */
function links(n: Notice): { sessionId: string | null; url: string | null; ref: string | null } {
  const sessionId = "sessionId" in n.data ? (n.data.sessionId ?? null) : n.sessionId;
  if ("pr" in n.data) return { sessionId, url: n.data.pr.url, ref: `#${n.data.pr.number}` };
  if (n.type === "issue.opened")
    return { sessionId: null, url: n.data.issue.url, ref: `#${n.data.issue.number}` };
  if (n.type === "pm.message") return { sessionId: n.data.fromSessionId, url: null, ref: null };
  return { sessionId, url: null, ref: null };
}

function NoticeRow({ notice }: { notice: Notice }) {
  const project = useProject(notice.projectId);
  const { icon: Icon, tone, label } = look[notice.type];
  const text = detail(notice);
  const link = links(notice);
  const workKey = "workKey" in notice.data ? notice.data.workKey : null;
  return (
    <div className="flex items-start gap-2.5 px-3 py-2" data-notice={notice.type}>
      <Icon className={cn("mt-0.5 size-3.5 shrink-0", tone)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-3xs text-muted-foreground">
          <span className={cn("font-medium", tone)}>{label}</span>
          {project && (
            <span className="inline-flex min-w-0 items-center gap-1">
              · <ProjectTile project={project} className="size-3 text-[7px]" />
              <span className="truncate">{project.name}</span>
            </span>
          )}
          {workKey && <code className="truncate font-mono">· {workKey}</code>}
          <span className="ml-auto shrink-0">{ago(notice.createdAt)}</span>
        </div>
        <p className="truncate text-[13px]">{notice.title}</p>
        {text && <p className="line-clamp-2 text-2xs text-muted-foreground">{text}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 pt-3">
        {link.url && (
          <button
            type="button"
            onClick={() => link.url && platform.openExternal(link.url)}
            className="inline-flex items-center gap-0.5 text-3xs text-primary hover:underline"
          >
            {link.ref ?? "GitHub"} <ArrowUpRight className="size-3" />
          </button>
        )}
        {link.sessionId && (
          <Link
            to="/sessions/$sessionId"
            params={{ sessionId: link.sessionId }}
            className="inline-flex items-center gap-0.5 text-3xs text-primary hover:underline"
          >
            Session <ArrowUpRight className="size-3" />
          </Link>
        )}
      </div>
    </div>
  );
}

/** Notices delivered with a wake (§8.2), rendered as compact typed cards. */
export function NoticeBatchCard({ notices }: { notices: Notice[] }) {
  return (
    <div
      className="divide-y divide-border/70 overflow-hidden rounded-xl border border-border bg-card"
      data-testid="notice-batch"
    >
      <div className="bg-muted/30 px-3 py-1.5 text-3xs font-semibold tracking-wider text-muted-foreground uppercase">
        {notices.length} {notices.length === 1 ? "update" : "updates"} since the last turn
      </div>
      {notices.map((n) => (
        <NoticeRow key={n.id} notice={n} />
      ))}
    </div>
  );
}
