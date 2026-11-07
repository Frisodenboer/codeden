import { z } from "zod";
import { Timestamp } from "./common";

/**
 * `GET /api/updates` (§16): the npm registry version check behind "Check for updates".
 * Cached by the server for a day; `?refresh=1` checks again now.
 */
export const UpdateStatus = z.object({
  /** The running version. */
  current: z.string(),
  /** Latest published version, null until a check succeeded. */
  latest: z.string().nullable(),
  /** `latest` is newer than `current`. */
  updateAvailable: z.boolean(),
  /** `settings.updates.check`; when off, nothing is fetched. */
  enabled: z.boolean(),
  checkedAt: Timestamp.nullable(),
  /** Why the last check failed (offline, registry error), else null. */
  error: z.string().nullable(),
  /** How to update, e.g. `npm i -g codeden@latest`. */
  command: z.string(),
});
export type UpdateStatus = z.infer<typeof UpdateStatus>;

/** True when version `a` is newer than `b` (`x.y.z`, prerelease tags sort before releases). */
export function isNewerVersion(a: string, b: string): boolean {
  const parse = (v: string) => {
    const [core = "", pre = ""] = v.trim().replace(/^v/, "").split("-", 2);
    return { nums: core.split(".").map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d > 0;
  }
  if (x.pre === y.pre) return false;
  if (!x.pre) return true; // release beats prerelease
  if (!y.pre) return false;
  return x.pre > y.pre;
}
