import {
  Brain,
  FilePen,
  FileText,
  Globe,
  ImageIcon,
  type LucideIcon,
  MousePointerClick,
  Plug,
  Search,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import type { WorkEntry } from "@/lib/transcript/timeline";

export function entryIcon(e: WorkEntry): LucideIcon {
  if (e.kind === "reasoning") return Brain;
  if (isImageTool(e)) return ImageIcon;
  switch (e.toolKind) {
    case "command":
      return SquareTerminal;
    case "file_edit":
      return FilePen;
    case "file_read":
      return FileText;
    case "search":
      return Search;
    case "web":
      return Globe;
    case "mcp":
      return Plug;
    case "browser":
      return MousePointerClick;
    default:
      return Wrench;
  }
}

/** Short verb phrase and a monospace target for a work entry. */
export function entryLabel(e: WorkEntry): { verb: string; target?: string; meta?: string } {
  if (e.kind === "reasoning")
    return { verb: e.status === "in_progress" ? "Thinking" : "Thought", target: e.summary };
  const running = e.status === "in_progress";
  switch (e.toolKind) {
    case "command":
      return { verb: running ? "Running" : "Ran", target: e.command };
    case "file_edit": {
      const add = e.changes.reduce((n, c) => n + (c.additions ?? 0), 0);
      const del = e.changes.reduce((n, c) => n + (c.deletions ?? 0), 0);
      const target = e.changes.length === 1 ? e.changes[0]?.path : `${e.changes.length} files`;
      return { verb: running ? "Editing" : "Edited", target, meta: `+${add} −${del}` };
    }
    case "file_read": {
      const range = e.startLine ? `:${e.startLine}${e.endLine ? `-${e.endLine}` : ""}` : "";
      return { verb: "Read", target: `${e.path}${range}` };
    }
    case "search":
      return {
        verb: "Searched",
        target: e.query,
        meta:
          e.matchCount !== undefined
            ? `${e.matchCount} matches${e.path ? ` in ${e.path}` : ""}`
            : e.path,
      };
    case "web":
      return { verb: "Fetched", target: e.title ?? e.url ?? e.query };
    case "mcp":
      if (isImageTool(e))
        return { verb: running ? "Generating image" : "Generated image", target: e.title };
      return { verb: e.title ?? `${e.server} · ${e.tool}`, meta: e.output?.text.split("\n")[0] };
    case "browser":
      return { verb: e.title ?? `Browser ${e.action}`, target: e.url };
    default:
      return { verb: e.title ?? e.toolName };
  }
}

export function isImageTool(e: WorkEntry): boolean {
  return e.kind === "tool_call" && e.toolKind === "mcp" && e.tool === "generate_image";
}

/** Artifact ids produced by a `generate_image` call. */
export function imageArtifacts(e: WorkEntry): string[] {
  if (e.kind !== "tool_call" || !isImageTool(e) || !e.output?.text) return [];
  try {
    const parsed = JSON.parse(e.output.text) as { artifactIds?: unknown };
    return Array.isArray(parsed.artifactIds)
      ? parsed.artifactIds.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
