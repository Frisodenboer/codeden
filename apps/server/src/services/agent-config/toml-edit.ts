import { isDeepStrictEqual } from "node:util";
import { parse, patch, stringify } from "@decimalturn/toml-patch";

type Table = Record<string, unknown>;

const isTable = (v: unknown): v is Table =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date);
const bare = (key: string) => (/^[A-Za-z0-9_-]+$/.test(key) ? key : JSON.stringify(key));
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `[mcp_servers.<name>]` with scalars and arrays, then one sub-table per flat map (env, headers). */
function serverBlock(name: string, server: Table): string | null {
  const head = `mcp_servers.${bare(name)}`;
  const lines = [`[${head}]`];
  const tables: string[] = [];
  for (const [key, value] of Object.entries(server)) {
    if (!isTable(value)) {
      lines.push(stringify({ [key]: value }).trim());
      continue;
    }
    if (Object.values(value).some(isTable)) return null;
    tables.push("", `[${head}.${bare(key)}]`);
    for (const [k, v] of Object.entries(value)) tables.push(stringify({ [k]: v }).trim());
  }
  return [...lines, ...tables].join("\n");
}

/**
 * Text edit of one `[mcp_servers.<name>]` block (and its `[mcp_servers.<name>.*]` sub-tables):
 * every other line of the file stays byte for byte. Returns null when the server is defined
 * some other way (inline table, dotted keys, a `[mcp_servers]` table), so the caller falls
 * back to a structural patch.
 */
function blockEdit(text: string, name: string, server: Table | undefined): string | null {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const names = [name, JSON.stringify(name), `'${name}'`].map(escapeRe).join("|");
  const own = new RegExp(
    `^\\s*\\[\\s*mcp_servers\\s*\\.\\s*(?:${names})\\s*(?:\\.[^\\]]*)?\\]\\s*(?:#.*)?$`,
  );
  const header = /^\s*\[/;
  // Other ways of defining servers: let the structural patch handle those files.
  if (lines.some((l) => /^\s*\[\s*mcp_servers\s*\]/.test(l) || /^\s*mcp_servers\s*[.=]/.test(l))) {
    return null;
  }
  const kept: string[] = [];
  let insertAt = -1;
  let inOwn = false;
  let pending: string[] = [];
  const giveBackComments = () => {
    // Comments (and blank lines) right above the next header describe that next block.
    let i = pending.length;
    while (i > 0 && /^\s*(#.*)?$/.test(pending[i - 1] ?? "")) i--;
    kept.push(...pending.slice(i));
    pending = [];
  };
  for (const line of lines) {
    if (header.test(line)) {
      const next = own.test(line);
      if (inOwn && !next) giveBackComments();
      inOwn = next;
    }
    if (inOwn) {
      if (insertAt < 0) insertAt = kept.length;
      pending.push(line);
      continue;
    }
    kept.push(line);
  }
  pending = [];
  if (!server) return insertAt < 0 ? null : trimBlankRuns(kept).join(eol);
  const block = serverBlock(name, server);
  if (block === null) return null;
  const blockLines = block.split("\n");
  if (insertAt >= 0) {
    kept.splice(insertAt, 0, ...blockLines, "");
    return trimBlankRuns(kept).join(eol);
  }
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  return [...kept, ...(kept.length ? [""] : []), ...blockLines, ""].join(eol);
}

/** Collapse runs of blank lines left behind by a removed block; keep one trailing newline. */
function trimBlankRuns(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.trim() === "" && out.length && out[out.length - 1]?.trim() === "") continue;
    out.push(line);
  }
  while (out.length > 1 && out[out.length - 1] === "" && out[out.length - 2] === "") out.pop();
  if (out[out.length - 1] !== "") out.push("");
  return out;
}

/**
 * Add, replace or remove `mcp_servers.<name>` in a Codex `config.toml`, preserving the rest of
 * the file. A targeted block edit is tried first and accepted only if the parsed result equals
 * the expected document; otherwise the structural `patch()` of the TOML library is used.
 */
export function editTomlServer(text: string, name: string, server: Table | undefined): string {
  const doc = parse(text) as Table;
  const servers = isTable(doc.mcp_servers) ? { ...doc.mcp_servers } : {};
  if (server) servers[name] = server;
  else delete servers[name];
  const expected: Table = { ...doc, mcp_servers: servers };
  if (!server && Object.keys(servers).length === 0) delete expected.mcp_servers;
  const edited = blockEdit(text, name, server);
  if (edited !== null) {
    try {
      if (isDeepStrictEqual(normalize(parse(edited)), normalize(expected))) return edited;
    } catch {
      // fall through to the structural patch
    }
  }
  return patch(text, expected);
}

/** Plain JSON view for comparisons (dates become strings, empty `mcp_servers` dropped). */
function normalize(value: unknown): unknown {
  const plain = JSON.parse(JSON.stringify(value)) as Table;
  if (isTable(plain.mcp_servers) && Object.keys(plain.mcp_servers).length === 0) {
    delete plain.mcp_servers;
  }
  return plain;
}
