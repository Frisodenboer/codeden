import { relative, resolve } from "node:path";

/** True when `child` is `dir` itself or somewhere inside it. */
export function isInside(dir: string, child: string): boolean {
  const rel = relative(resolve(dir), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !/^[a-zA-Z]:/.test(rel));
}
