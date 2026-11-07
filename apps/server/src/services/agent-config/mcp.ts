import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type {
  AgentConfigDiff,
  McpConfigScope,
  McpServerEntry,
  McpServerSpec,
  McpServerTarget,
} from "@codeden/contracts";
import { parse as parseToml } from "@decimalturn/toml-patch";
import { badRequest, ServiceError } from "../errors";
import { atomicWrite, unifiedDiff } from "./files";
import { editTomlServer } from "./toml-edit";

type Native = Record<string, unknown>;
type Provider = "claude" | "codex";

/** One native file holding MCP servers, and where in it they live. */
export interface McpSource {
  provider: Provider;
  scope: McpConfigScope;
  file: string;
  format: "json" | "toml";
  /** Key path to the servers table, e.g. `["projects", "C:/repo", "mcpServers"]`. */
  keyPath: string[];
  projectId: string | null;
}

const CLAUDE_TRANSPORT = ["type", "command", "args", "env", "url", "headers"];
const CODEX_TRANSPORT = [
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "http_headers",
  "bearer_token_env_var",
  "enabled",
];

const isRecord = (v: unknown): v is Native =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): Record<string, string> | undefined =>
  isRecord(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) : undefined;
const stringList = (v: unknown): string[] | undefined =>
  Array.isArray(v) ? v.map((x) => String(x)) : undefined;
const omit = (o: Native, keys: string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const compact = <T extends Native>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Native server config -> provider-neutral spec (unknown fields kept in `extra`). */
export function toSpec(provider: Provider, native: Native): McpServerSpec {
  const extraKeys = provider === "claude" ? CLAUDE_TRANSPORT : CODEX_TRANSPORT;
  const extra = omit(native, extraKeys);
  const withExtra = Object.keys(extra).length ? { extra } : {};
  const enabled =
    provider === "codex" && typeof native.enabled === "boolean" ? native.enabled : undefined;
  const url = typeof native.url === "string" ? native.url : undefined;
  if (url) {
    const type = native.type === "sse" ? "sse" : "http";
    return compact({
      type,
      url,
      headers: strings(provider === "claude" ? native.headers : native.http_headers),
      bearerTokenEnvVar:
        typeof native.bearer_token_env_var === "string" ? native.bearer_token_env_var : undefined,
      enabled,
      ...withExtra,
    }) as McpServerSpec;
  }
  return compact({
    type: "stdio",
    command: typeof native.command === "string" ? native.command : "",
    args: stringList(native.args),
    env: strings(native.env),
    cwd: typeof native.cwd === "string" ? native.cwd : undefined,
    enabled,
    ...withExtra,
  }) as McpServerSpec;
}

/** Spec -> native config, merged over the existing native entry so other fields survive. */
export function toNative(provider: Provider, spec: McpServerSpec, existing: Native = {}): Native {
  const keep = omit(existing, provider === "claude" ? CLAUDE_TRANSPORT : CODEX_TRANSPORT);
  const base = { ...keep, ...(spec.extra ?? {}) };
  if (provider === "claude") {
    return spec.type === "stdio"
      ? compact({
          ...base,
          type: "stdio",
          command: spec.command,
          args: spec.args ?? [],
          env: spec.env ?? {},
        })
      : compact({ ...base, type: spec.type, url: spec.url, headers: spec.headers });
  }
  return spec.type === "stdio"
    ? compact({
        ...base,
        command: spec.command,
        args: spec.args,
        env: spec.env,
        cwd: spec.cwd,
        enabled: spec.enabled,
      })
    : compact({
        ...base,
        url: spec.url,
        http_headers: spec.headers,
        bearer_token_env_var: spec.bearerTokenEnvVar,
        enabled: spec.enabled,
      });
}

/** `~/.claude.json` keys projects by path with forward slashes on Windows. */
export function claudeProjectKey(doc: Native, projectPath: string): string {
  const key = process.platform === "win32" ? projectPath.replace(/\\/g, "/") : projectPath;
  const projects = isRecord(doc.projects) ? doc.projects : {};
  const fold = (s: string) => (process.platform === "linux" ? s : s.toLowerCase());
  return Object.keys(projects).find((k) => fold(k) === fold(key)) ?? key;
}

interface Loaded {
  text: string | null;
  doc: Native;
}

function load(source: McpSource): Loaded {
  if (!existsSync(source.file)) return { text: null, doc: {} };
  const text = readFileSync(source.file, "utf8");
  try {
    const doc = source.format === "json" ? (JSON.parse(text) as unknown) : parseToml(text);
    if (!isRecord(doc)) throw new Error("not an object");
    return { text, doc };
  } catch (error) {
    throw new ServiceError(
      422,
      "config_unparsable",
      `${source.file} could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function tableAt(doc: Native, keyPath: string[], create: boolean): Native | undefined {
  let node: Native = doc;
  for (const key of keyPath) {
    const next = node[key];
    if (!isRecord(next)) {
      if (!create) return undefined;
      node[key] = {};
    }
    node = node[key] as Native;
  }
  return node;
}

/** The servers defined in one source. */
export function readServers(source: McpSource): McpServerEntry[] {
  const table = tableAt(load(source).doc, source.keyPath, false) ?? {};
  return Object.entries(table)
    .filter(([, native]) => isRecord(native))
    .map(([name, native]) => ({
      provider: source.provider,
      scope: source.scope,
      name,
      spec: toSpec(source.provider, native as Native),
      file: source.file,
      projectId: source.projectId,
    }));
}

/** The new file text for an upsert (`spec`) or removal (no `spec`). Pure apart from reading. */
export function renderChange(source: McpSource, name: string, spec: McpServerSpec | undefined) {
  const { text, doc } = load(source);
  const table = tableAt(doc, source.keyPath, spec !== undefined);
  const current = table?.[name];
  if (!spec && !(table && name in table)) {
    throw new ServiceError(
      404,
      "server_not_found",
      `No MCP server named ${name} in ${source.file}`,
    );
  }
  const native = spec
    ? toNative(source.provider, spec, isRecord(current) ? current : {})
    : undefined;
  if (native && isRecord(current) && isDeepStrictEqual(native, current)) {
    return { before: text ?? "", after: text ?? "", existed: text !== null };
  }
  let next: string;
  if (source.format === "toml") {
    next = editTomlServer(text ?? "", name, native);
  } else {
    if (native) (table as Native)[name] = native;
    else delete (table as Native)[name];
    const indent = text ? (/^\{\r?\n(\s+)"/.exec(text)?.[1] ?? "  ") : "  ";
    const trailing = text === null || text.endsWith("\n") ? "\n" : "";
    next = `${JSON.stringify(doc, null, indent)}${trailing}`;
  }
  return { before: text ?? "", after: next, existed: text !== null };
}

/** Preview a change as a unified diff. */
export function diffChange(source: McpSource, name: string, spec?: McpServerSpec): AgentConfigDiff {
  const { before, after, existed } = renderChange(source, name, spec);
  return unifiedDiff(source.file, existed, before, after);
}

/** Write a change; `backup` copies the current file first. */
export function applyChange(
  source: McpSource,
  name: string,
  spec: McpServerSpec | undefined,
  backup: (file: string) => string,
): string | null {
  const { after, existed } = renderChange(source, name, spec);
  const backupPath = existed ? backup(source.file) : null;
  atomicWrite(source.file, after);
  return backupPath;
}

/** Resolve an edit target to its native source. */
export function sourceFor(
  target: Pick<McpServerTarget, "provider" | "scope">,
  home: string,
  project: { id: string; path: string } | null,
): McpSource {
  const claudeJson = join(home, ".claude.json");
  if (target.provider === "codex") {
    if (target.scope !== "user")
      throw badRequest("Codex MCP servers are edited in ~/.codex/config.toml (user scope)");
    return {
      provider: "codex",
      scope: "user",
      file: join(home, ".codex", "config.toml"),
      format: "toml",
      keyPath: ["mcp_servers"],
      projectId: null,
    };
  }
  if (target.scope === "user") {
    return {
      provider: "claude",
      scope: "user",
      file: claudeJson,
      format: "json",
      keyPath: ["mcpServers"],
      projectId: null,
    };
  }
  if (!project) throw badRequest("projectId is required for this scope", "project_required");
  if (target.scope === "project") {
    return {
      provider: "claude",
      scope: "project",
      file: join(project.path, ".mcp.json"),
      format: "json",
      keyPath: ["mcpServers"],
      projectId: project.id,
    };
  }
  const key = claudeProjectKey(
    existsSync(claudeJson) ? load({ file: claudeJson, format: "json" } as McpSource).doc : {},
    project.path,
  );
  return {
    provider: "claude",
    scope: "local",
    file: claudeJson,
    format: "json",
    keyPath: ["projects", key, "mcpServers"],
    projectId: project.id,
  };
}
