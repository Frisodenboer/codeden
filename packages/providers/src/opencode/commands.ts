import { quickLocate } from "../util/locate";
import { OpencodeServer } from "./process";
import type { OcCommand } from "./types";

/** One slash command opencode accepts in a folder. */
export interface OpencodeCommand {
  name: string;
  description: string;
  /** `command` (opencode config, MCP prompts) or `skill`. */
  kind: "command" | "skill";
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; list: Promise<OpencodeCommand[]> }>();

/** opencode's command list -> composer rows. */
export function toOpencodeCommands(list: readonly OcCommand[]): OpencodeCommand[] {
  return list.map((c) => ({
    name: c.name,
    description: [c.description ?? "", c.hints.length ? c.hints.join(" ") : ""]
      .filter(Boolean)
      .join(" · "),
    kind: c.source === "skill" ? "skill" : "command",
  }));
}

/**
 * The slash commands opencode supports in `cwd` (its config's commands, MCP prompts and
 * skills), for the composer's `/` menu. Asks a short-lived `opencode serve` (nothing is sent to
 * a model), cached per folder for a minute. Resolves to an empty list when opencode is missing.
 */
export function listOpencodeCommands(cwd: string): Promise<OpencodeCommand[]> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  const list = (async () => {
    if (!quickLocate("opencode")) return [];
    const server = new OpencodeServer(() => quickLocate("opencode"));
    try {
      const client = await server.client();
      return toOpencodeCommands(await client.commands(cwd));
    } finally {
      await server.stop();
    }
  })().catch(() => [] as OpencodeCommand[]);
  cache.set(cwd, { at: Date.now(), list });
  return list;
}

/** `/name rest` -> `{ name, args }`, or undefined when the text is not a slash command. */
export function parseSlashCommand(text: string): { name: string; args: string } | undefined {
  const m = /^\/([\w.:-]+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  return m?.[1] ? { name: m[1], args: (m[2] ?? "").trim() } : undefined;
}
