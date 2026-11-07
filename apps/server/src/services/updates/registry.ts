import type { ReleaseNotes } from "@codeden/contracts";
import { PACKAGE_NAME } from "./app-dir";

/** The public npm registry; `CODEDEN_UPDATE_REGISTRY` overrides it (tests only). */
export const DEFAULT_REGISTRY = "https://registry.npmjs.org";
const RELEASES_API = "https://api.github.com/repos/leonvanzyl/codeden/releases/tags/v{version}";
const RELEASE_PAGE = "https://github.com/leonvanzyl/codeden/releases/tag/v{version}";
const CHANGELOG = "https://raw.githubusercontent.com/leonvanzyl/codeden/main/CHANGELOG.md";
const TIMEOUT_MS = 5_000;

/** The registry this process checks and installs from. */
export function updateRegistry(env: NodeJS.ProcessEnv = process.env): string {
  return (env.CODEDEN_UPDATE_REGISTRY || DEFAULT_REGISTRY).replace(/\/+$/, "");
}

/**
 * `dist-tags.latest` of the `codeden` package. Only the package name goes out: no ids, no
 * machine details, no usage data.
 */
export async function fetchLatestVersion(
  registry: string,
  doFetch: typeof fetch = fetch,
): Promise<string> {
  const res = await doFetch(`${registry}/-/package/${PACKAGE_NAME}/dist-tags`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`registry answered ${res.status}`);
  const body = (await res.json()) as { latest?: unknown };
  if (typeof body.latest !== "string") throw new Error("registry sent no latest version");
  return body.latest;
}

export interface NotesSources {
  /** GitHub Release JSON (`{ body, html_url }`); `{version}` is replaced. */
  releaseApi?: string;
  /** Raw CHANGELOG.md used when the release has no body; `""` skips it. */
  changelog?: string;
}

/** Notes sources; `CODEDEN_RELEASE_NOTES_URL` points the release lookup elsewhere (tests). */
export function notesSources(env: NodeJS.ProcessEnv = process.env): NotesSources {
  const override = env.CODEDEN_RELEASE_NOTES_URL;
  return override ? { releaseApi: override, changelog: "" } : {};
}

/**
 * Release notes for "What's new": the GitHub Release body, else the version's CHANGELOG
 * section, else null with a link to the release page. Fetched only when asked for.
 */
export async function fetchReleaseNotes(
  version: string,
  sources: NotesSources = {},
  doFetch: typeof fetch = fetch,
): Promise<ReleaseNotes> {
  const fill = (template: string) => template.replaceAll("{version}", encodeURIComponent(version));
  let url = fill(RELEASE_PAGE);
  try {
    const res = await doFetch(fill(sources.releaseApi ?? RELEASES_API), {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) {
      const body = (await res.json()) as { body?: unknown; html_url?: unknown };
      if (typeof body.html_url === "string") url = body.html_url;
      if (typeof body.body === "string" && body.body.trim()) {
        return { version, body: body.body.trim(), url };
      }
    }
  } catch {
    // Offline or rate limited: try the changelog.
  }
  const changelog = sources.changelog ?? CHANGELOG;
  if (changelog) {
    try {
      const res = await doFetch(changelog, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) {
        const section = changelogSection(await res.text(), version);
        if (section) return { version, body: section, url };
      }
    } catch {
      // Unreachable: no notes, just the link.
    }
  }
  return { version, body: null, url };
}

/** The body of `## [<version>]` (or `## <version>`) up to the next `## ` heading. */
export function changelogSection(markdown: string, version: string): string | null {
  const lines = markdown.split(/\r?\n/);
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const heading = new RegExp(`^##\\s+\\[?v?${escaped}\\]?(\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  const body = (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
  return body || null;
}
