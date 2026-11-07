import { CommandError } from "../errors";

const ALLOWED_SCHEMES = new Set(["http:", "https:", "file:", "data:", "about:"]);

/**
 * Validate and normalize a URL for navigation. A bare `host[:port][/path]` gets `http://`;
 * browser-internal schemes (`edge://`, `chrome://`, `devtools://`) and `javascript:` are refused.
 */
export function normalizeUrl(input: string): string {
  const raw = input.trim();
  if (raw === "") throw new CommandError("invalid_url", "URL is empty");
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^[^/:]+:\d+(\/|$)/.test(raw);
  const candidate = hasScheme ? raw : `http://${raw}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new CommandError("invalid_url", `Not a valid URL: ${input}`);
  }
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new CommandError("invalid_url", `URL scheme ${url.protocol} is not allowed`);
  }
  return url.href;
}

/** URL of a local dev server on `port`. */
export function devServerUrl(port: number, path = "/"): string {
  return `http://localhost:${port}${path.startsWith("/") ? path : `/${path}`}`;
}
