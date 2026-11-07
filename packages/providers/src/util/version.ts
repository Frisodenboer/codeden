/** Parse the first `x.y.z` in a string. */
export function parseVersion(text: string): string | null {
  return /(\d+\.\d+\.\d+(?:-[\w.]+)?)/.exec(text)?.[1] ?? null;
}

/** Compare two `x.y.z` versions numerically (prerelease tags ignored). */
export function compareVersions(a: string, b: string): number {
  const pa = a
    .split(/[.-]/)
    .slice(0, 3)
    .map((n) => Number.parseInt(n, 10) || 0);
  const pb = b
    .split(/[.-]/)
    .slice(0, 3)
    .map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
