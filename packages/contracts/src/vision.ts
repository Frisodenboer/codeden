import type { ParsedVision, ProtectedAreas } from "./factory-api";

/**
 * Parsing of a project vision file (§10.1): `##` sections whose bullets are the entries.
 * Protected areas become path globs (anything in backticks, or that looks like a path) and
 * topics (plain words). Shared so the server's merge checks and the UI's live preview agree.
 */

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
