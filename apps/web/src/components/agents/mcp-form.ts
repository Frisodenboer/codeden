import type { McpServerSpec } from "@codeden/contracts";

/** The MCP server form as plain strings (one entry per line for args, env and headers). */
export interface McpForm {
  type: "stdio" | "http" | "sse";
  command: string;
  args: string;
  env: string;
  cwd: string;
  url: string;
  headers: string;
  bearerTokenEnvVar: string;
  enabled: boolean;
}

export const emptyMcpForm: McpForm = {
  type: "stdio",
  command: "",
  args: "",
  env: "",
  cwd: "",
  url: "",
  headers: "",
  bearerTokenEnvVar: "",
  enabled: true,
};

const lines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** `KEY=value` (env) or `Name: value` (headers) lines to a record. */
export function parsePairs(text: string, sep: "=" | ":"): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const line of lines(text)) {
    const at = line.indexOf(sep);
    if (at <= 0) continue;
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return Object.keys(out).length ? out : undefined;
}

const pairsText = (rec: Record<string, string> | undefined, sep: string) =>
  Object.entries(rec ?? {})
    .map(([k, v]) => `${k}${sep}${v}`)
    .join("\n");

export function specToForm(spec: McpServerSpec): McpForm {
  if (spec.type === "stdio") {
    return {
      ...emptyMcpForm,
      type: "stdio",
      command: spec.command,
      args: (spec.args ?? []).join("\n"),
      env: pairsText(spec.env, "="),
      cwd: spec.cwd ?? "",
      enabled: spec.enabled !== false,
    };
  }
  return {
    ...emptyMcpForm,
    type: spec.type,
    url: spec.url,
    headers: pairsText(spec.headers, ": "),
    bearerTokenEnvVar: spec.bearerTokenEnvVar ?? "",
    enabled: spec.enabled !== false,
  };
}

/**
 * The form as a provider-neutral spec. `previous` keeps unknown native fields (`extra`) of the
 * server being edited; `enabled` is written only where the provider supports it.
 */
export function formToSpec(
  form: McpForm,
  opts: { supportsEnabled: boolean; previous?: McpServerSpec },
): McpServerSpec {
  const extra = opts.previous?.extra;
  const enabled = opts.supportsEnabled && !form.enabled ? { enabled: false } : {};
  if (form.type === "stdio") {
    const args = lines(form.args);
    return {
      type: "stdio",
      command: form.command.trim(),
      ...(args.length ? { args } : {}),
      ...(parsePairs(form.env, "=") ? { env: parsePairs(form.env, "=") } : {}),
      ...(form.cwd.trim() ? { cwd: form.cwd.trim() } : {}),
      ...enabled,
      ...(extra ? { extra } : {}),
    };
  }
  return {
    type: form.type,
    url: form.url.trim(),
    ...(parsePairs(form.headers, ":") ? { headers: parsePairs(form.headers, ":") } : {}),
    ...(form.bearerTokenEnvVar.trim() ? { bearerTokenEnvVar: form.bearerTokenEnvVar.trim() } : {}),
    ...enabled,
    ...(extra ? { extra } : {}),
  };
}

/** True when the form has what its transport needs. */
export function mcpFormValid(form: McpForm): boolean {
  return form.type === "stdio"
    ? form.command.trim().length > 0
    : /^https?:\/\//.test(form.url.trim());
}

/** One-line summary of a server for lists. */
export function specSummary(spec: McpServerSpec): string {
  return spec.type === "stdio" ? [spec.command, ...(spec.args ?? [])].join(" ") : spec.url;
}
