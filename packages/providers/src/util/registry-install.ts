import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { extractTarGz } from "./tar";

/** The public npm registry. */
export const NPM_REGISTRY = "https://registry.npmjs.org";

export interface RegistryInstallOptions {
  /** Package name, e.g. `@anthropic-ai/claude-agent-sdk`. */
  name: string;
  /** Exact version (no ranges). */
  version: string;
  /** The `node_modules` folder to install into. */
  nodeModules: string;
  /** Registry base URL (default: `npm_config_registry`, then the public registry). */
  registry?: string;
  onProgress?: (line: string) => void;
  fetch?: typeof fetch;
  /** Whole-install timeout (default 5 minutes). */
  timeoutMs?: number;
}

interface VersionManifest {
  name?: unknown;
  version?: unknown;
  dist?: { tarball?: unknown; integrity?: unknown };
}

/** The registry to use: an explicit one, npm's configured one, or the public registry. */
export function registryUrl(explicit?: string, env: NodeJS.ProcessEnv = process.env): string {
  return (explicit ?? env.npm_config_registry ?? NPM_REGISTRY).replace(/\/+$/, "");
}

/**
 * Install one exact package version straight from an npm registry, without npm (the desktop
 * app has no npm, §17): read the version manifest, download the tarball, check it against the
 * manifest's `dist.integrity` (sha512), extract it into a staging folder and move it into
 * `<nodeModules>/<name>`. Dependencies are not installed: use it only for packages whose
 * runtime needs none (the Claude Agent SDK, installed without optional and peer deps).
 */
export async function installFromRegistry(opts: RegistryInstallOptions): Promise<void> {
  const doFetch = opts.fetch ?? fetch;
  const progress = opts.onProgress ?? (() => {});
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 300_000);
  const base = registryUrl(opts.registry);
  const spec = `${opts.name}@${opts.version}`;
  const manifestUrl = `${base}/${opts.name.replace("/", "%2f")}/${encodeURIComponent(opts.version)}`;

  progress(`Looking up ${spec}`);
  const res = await doFetch(manifestUrl, { headers: { accept: "application/json" }, signal });
  if (!res.ok) throw new Error(`the registry answered ${res.status} for ${spec}`);
  const manifest = (await res.json()) as VersionManifest;
  if (manifest.name !== opts.name || manifest.version !== opts.version) {
    throw new Error(`the registry returned the wrong package for ${spec}`);
  }
  const tarball = manifest.dist?.tarball;
  const integrity = manifest.dist?.integrity;
  if (typeof tarball !== "string" || !/^https?:\/\//.test(tarball)) {
    throw new Error(`${spec} has no tarball URL`);
  }
  const expected = typeof integrity === "string" ? sha512Of(integrity) : null;
  if (!expected) throw new Error(`${spec} has no sha512 integrity to check the download against`);

  progress(`Downloading ${spec}`);
  const download = await doFetch(tarball, { signal });
  if (!download.ok) throw new Error(`downloading ${spec} failed (${download.status})`);
  const archive = Buffer.from(await download.arrayBuffer());
  const actual = createHash("sha512").update(archive).digest("base64");
  if (actual !== expected) {
    throw new Error(`the download of ${spec} does not match its published integrity (sha512)`);
  }

  progress(`Unpacking ${spec}`);
  const target = path.join(opts.nodeModules, ...opts.name.split("/"));
  const staging = `${target}.staging-${randomBytes(4).toString("hex")}`;
  try {
    mkdirSync(staging, { recursive: true });
    extractTarGz(archive, staging, { strip: 1 });
    rmSync(target, { recursive: true, force: true, maxRetries: 3 });
    renameSync(staging, target);
  } finally {
    rmSync(staging, { recursive: true, force: true, maxRetries: 2 });
  }
}

/** The base64 sha512 digest in a Subresource Integrity string (`sha512-<base64> ...`). */
export function sha512Of(integrity: string): string | null {
  for (const part of integrity.trim().split(/\s+/)) {
    if (part.startsWith("sha512-")) return part.slice("sha512-".length).replace(/\?.*$/, "");
  }
  return null;
}
