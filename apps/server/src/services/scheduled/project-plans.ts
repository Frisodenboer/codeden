import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { PlannedItem } from "@codeden/contracts";
import { parse as parseYaml } from "yaml";
import { nextOccurrences } from "../automations/cron";

/** How many upcoming runs of each scheduled workflow to show. */
const WORKFLOW_RUNS = 3;
/** Most queued posts mapped onto future runs per project. */
const MAX_GBP = 52;
/** Most plan-file items per project. */
const MAX_PLAN = 200;

export interface PlanProject {
  id: string;
  name: string;
  path: string;
}

interface Workflow {
  file: string;
  name: string;
  crons: string[];
  text: string;
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Scheduled GitHub Actions workflows (`on.schedule[].cron`, always UTC). */
function readWorkflows(root: string): Workflow[] {
  const dir = join(root, ".github", "workflows");
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => /\.ya?ml$/i.test(f));
  } catch {
    return [];
  }
  const out: Workflow[] = [];
  for (const file of files) {
    let text: string;
    let doc: unknown;
    try {
      text = readFileSync(join(dir, file), "utf8");
      doc = parseYaml(text);
    } catch {
      continue;
    }
    if (!doc || typeof doc !== "object") continue;
    const d = doc as { name?: unknown; on?: unknown; true?: unknown };
    const on = (d.on ?? d.true) as { schedule?: unknown } | undefined;
    const schedule = on && typeof on === "object" ? on.schedule : undefined;
    if (!Array.isArray(schedule)) continue;
    const crons = schedule
      .map((s) => (s && typeof s === "object" ? (s as { cron?: unknown }).cron : undefined))
      .filter((c): c is string => typeof c === "string");
    if (crons.length === 0) continue;
    out.push({ file, name: typeof d.name === "string" ? d.name : file, crons, text });
  }
  return out;
}

/** The next `count` runs across all of a workflow's crons, soonest first. */
function runsOf(w: Workflow, count: number, now: Date): Date[] {
  return w.crons
    .flatMap((c) => nextOccurrences(c, "UTC", count, now))
    .sort((a, b) => a.getTime() - b.getTime())
    .slice(0, count);
}

/**
 * Queued Google Business Profile posts (`scripts/gbp-posts.json`, the gbp skill): the publish
 * workflow posts the oldest pending entry on each run, so pending post N goes out on run N.
 */
function gbpPlans(project: PlanProject, workflows: Workflow[], now: Date): PlannedItem[] {
  const queue = readJson(join(project.path, "scripts", "gbp-posts.json")) as {
    entries?: { id?: unknown; path?: unknown; summary?: unknown; status?: unknown }[];
  } | null;
  if (!queue || !Array.isArray(queue.entries)) return [];
  const pending = queue.entries.filter((e) => e && e.status === "pending").slice(0, MAX_GBP);
  if (pending.length === 0) return [];
  const publisher = workflows.find((w) => w.text.includes("gbp-posts.json"));
  const runs = publisher ? runsOf(publisher, pending.length, now) : [];
  return pending.flatMap((e, i) => {
    const at = runs[i];
    if (!at) return [];
    const page = typeof e.path === "string" ? e.path : String(e.id ?? "post");
    return [
      {
        id: `gbp:${project.id}:${String(e.id ?? i)}`,
        projectId: project.id,
        at: at.toISOString(),
        source: "gbp" as const,
        title: `Google Business post: ${page}`,
        detail: typeof e.summary === "string" ? e.summary : null,
      },
    ];
  });
}

/** Items from `.codebench/plan.json`: `{ "items": [{ "title", "at", "detail"? }] }`. */
function planFile(project: PlanProject, now: Date): PlannedItem[] {
  const plan = readJson(join(project.path, ".codebench", "plan.json")) as {
    items?: { title?: unknown; at?: unknown; detail?: unknown }[];
  } | null;
  if (!plan || !Array.isArray(plan.items)) return [];
  return plan.items.slice(0, MAX_PLAN).flatMap((it, i) => {
    if (!it || typeof it.title !== "string" || typeof it.at !== "string") return [];
    const at = new Date(it.at);
    if (Number.isNaN(at.getTime()) || at.getTime() < now.getTime()) return [];
    return [
      {
        id: `plan:${project.id}:${i}`,
        projectId: project.id,
        at: at.toISOString(),
        source: "plan" as const,
        title: it.title,
        detail: typeof it.detail === "string" ? it.detail : null,
      },
    ];
  });
}

/** Everything planned in the project folders, soonest first. Missing or broken files are skipped. */
export function collectProjectPlans(projects: PlanProject[], now = new Date()): PlannedItem[] {
  const items: PlannedItem[] = [];
  for (const project of projects) {
    if (!existsSync(project.path)) continue;
    const workflows = readWorkflows(project.path);
    const gbp = gbpPlans(project, workflows, now);
    for (const w of workflows) {
      // A post publisher's runs already show as the queued posts.
      if (gbp.length > 0 && w.text.includes("gbp-posts.json")) continue;
      for (const at of runsOf(w, WORKFLOW_RUNS, now)) {
        items.push({
          id: `workflow:${project.id}:${w.file}:${at.toISOString()}`,
          projectId: project.id,
          at: at.toISOString(),
          source: "workflow",
          title: `GitHub workflow: ${w.name}`,
          detail: `.github/workflows/${w.file}`,
        });
      }
    }
    items.push(...gbp, ...planFile(project, now));
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));
}
