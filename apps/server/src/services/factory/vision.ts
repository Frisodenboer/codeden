import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import type { ParsedVision, Project, ProtectedAreas, VisionResponse } from "@codeden/contracts";
import { badRequest } from "../errors";

/**
 * The project vision (§10.1): `.codeden/VISION.md`, required for autopilot and dark factory.
 * Sections are `##` headings; bullets under them are the entries. Protected areas become path
 * globs (anything in backticks, or that looks like a path) and topics (plain words).
 */

export const VISION_TEMPLATE = `# Vision

Describe what this project is for. The factory scores every piece of work against this file.

## Goals
- What should this project achieve in the next months?

## Target users
- Who uses it, and what do they need?

## Principles
- Small, well-tested changes
- Keep the public API stable

## Out of scope
- Things the factory must never propose

## Quality bar
- Every behaviour change comes with tests
- CI is green before merge

## Protected areas
Paths (globs in backticks) and topics that always need a human. The factory never merges
changes that touch them; they go to your inbox.
- \`**/auth/**\`
- \`**/migrations/**\`
- \`.github/workflows/**\`
- \`LICENSE\`
- payments
- licensing
`;

type SectionKey = keyof Omit<ParsedVision, "protectedAreas"> | "protected";

const SECTIONS: Array<[RegExp, SectionKey]> = [
  [/^goals?\b/i, "goals"],
  [/^(target\s+)?users?\b|^audience/i, "users"],
  [/^principles?\b|^values?\b/i, "principles"],
  [/^out\s+of\s+scope|^non[-\s]?goals?/i, "outOfScope"],
  [/^quality(\s+bar)?\b/i, "qualityBar"],
  [/^protected(\s+areas?)?\b/i, "protected"],
];

/** Topics that also imply paths, so "payments" protects `src/payments/...` too. */
const TOPIC_GLOBS: Record<string, string[]> = {
  auth: ["**/auth/**", "**/*auth*.*"],
  authentication: ["**/auth/**", "**/*auth*.*"],
  payments: ["**/payment*/**", "**/billing/**", "**/*payment*.*", "**/*billing*.*"],
  billing: ["**/billing/**", "**/*billing*.*"],
  "data migrations": ["**/migrations/**", "**/*migration*.*"],
  migrations: ["**/migrations/**", "**/*migration*.*"],
  infrastructure: ["**/infra/**", "**/terraform/**", "**/*.tf", ".github/workflows/**"],
  infra: ["**/infra/**", "**/terraform/**", "**/*.tf", ".github/workflows/**"],
  licensing: ["LICENSE", "LICENSE.*", "COPYING"],
  license: ["LICENSE", "LICENSE.*", "COPYING"],
};

/** Paths that deploy or release, protected unless `allowDeploys` is on. */
export const DEPLOY_GLOBS = [
  ".github/workflows/*deploy*",
  ".github/workflows/*release*",
  ".github/workflows/*publish*",
  "**/Dockerfile",
  "**/fly.toml",
  "**/vercel.json",
  "**/netlify.toml",
];

function cleanBullet(line: string): string | null {
  const m = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
  if (!m?.[1]) return null;
  const text = m[1].trim();
  if (!text || /^\[ \]$/.test(text)) return null;
  return text;
}

/** Parse a vision file. Unknown sections are ignored; missing ones are empty. */
export function parseVision(markdown: string): ParsedVision {
  const out: ParsedVision = {
    goals: [],
    users: [],
    principles: [],
    outOfScope: [],
    qualityBar: [],
    protectedAreas: { globs: [], topics: [] },
  };
  const protectedLines: string[] = [];
  let section: SectionKey | null = null;
  for (const raw of markdown.split(/\r?\n/)) {
    const heading = /^#{2,3}\s+(.+?)\s*#*\s*$/.exec(raw);
    if (heading?.[1]) {
      section = SECTIONS.find(([re]) => re.test(heading[1] ?? ""))?.[1] ?? null;
      continue;
    }
    if (!section) continue;
    const bullet = cleanBullet(raw);
    if (!bullet) continue;
    if (section === "protected") protectedLines.push(bullet);
    else out[section].push(bullet);
  }
  out.protectedAreas = parseProtectedAreas(protectedLines);
  return out;
}

/** Split protected-area bullets into path globs and topics. */
export function parseProtectedAreas(lines: string[]): ProtectedAreas {
  const globs = new Set<string>();
  const topics = new Set<string>();
  for (const line of lines) {
    const ticks = [...line.matchAll(/`([^`]+)`/g)].map((m) => (m[1] ?? "").trim()).filter(Boolean);
    if (ticks.length > 0) {
      for (const t of ticks) globs.add(t);
      continue;
    }
    const first = line.split(/\s+[-:(]|\s+—\s+|,/)[0]?.trim() ?? "";
    if (/[/*]/.test(first) || /^[\w.-]+\.\w{1,6}$/.test(first) || /^[A-Z]+$/.test(first)) {
      globs.add(first);
      continue;
    }
    const topic = first.toLowerCase().replace(/[.:;]+$/, "");
    if (!topic) continue;
    topics.add(topic);
    for (const g of TOPIC_GLOBS[topic] ?? []) globs.add(g);
  }
  return { globs: [...globs], topics: [...topics] };
}

/** True when `topic` appears as a word or phrase in `text`. */
export function mentionsTopic(text: string, topic: string): boolean {
  const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function visionFile(project: Project): string {
  const file = resolve(project.path, project.visionPath);
  const rel = relative(project.path, file);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw badRequest("The vision path must stay inside the project", "invalid_vision_path");
  }
  return file;
}

/** Read the vision; the template (and `exists: false`) when the file is missing. */
export function readVision(project: Project): VisionResponse {
  const file = visionFile(project);
  const exists = existsSync(file);
  const contents = exists ? readFileSync(file, "utf8") : VISION_TEMPLATE;
  return { path: project.visionPath, exists, contents, parsed: parseVision(contents) };
}

/** Write the vision atomically (in the main checkout; commit it to share it with agents). */
export function writeVision(project: Project, contents: string): VisionResponse {
  const file = visionFile(project);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, contents.endsWith("\n") ? contents : `${contents}\n`);
  renameSync(tmp, file);
  return readVision(project);
}
