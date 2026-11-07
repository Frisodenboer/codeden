/**
 * Small glob matcher for protected paths (§10.1): `**` matches any number of path segments,
 * `*` anything but `/`, `?` one character. Paths use forward slashes and are relative to the
 * repo root. A pattern without a slash matches the base name anywhere (`LICENSE`, `*.pem`).
 */

const cache = new Map<string, RegExp>();

function toRegExp(pattern: string): RegExp {
  const cached = cache.get(pattern);
  if (cached) return cached;
  let p = pattern.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!p.includes("/")) p = `**/${p}`;
  if (p.endsWith("/")) p = `${p}**`;
  let out = "";
  for (let i = 0; i < p.length; i++) {
    const c = p.charAt(i);
    if (c === "*" && p.charAt(i + 1) === "*") {
      // `**/` = zero or more directories; a trailing `**` = everything below.
      if (p.charAt(i + 2) === "/") {
        out += "(?:[^/]+/)*";
        i += 2;
      } else {
        out += ".*";
        i += 1;
      }
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  const re = new RegExp(`^${out}$`);
  cache.set(pattern, re);
  return re;
}

/** True when `path` matches `pattern`. */
export function matchesGlob(path: string, pattern: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  return toRegExp(pattern).test(normalized);
}

/** The patterns `path` matches. */
export function matchingGlobs(path: string, patterns: readonly string[]): string[] {
  return patterns.filter((p) => matchesGlob(path, p));
}
