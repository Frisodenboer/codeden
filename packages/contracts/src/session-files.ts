import { z } from "zod";

/**
 * Read-only browsing of a session's working directory for the files panel (§12.3).
 * Paths are relative to the session's worktree (or cwd) and use `/` separators.
 */

/** One entry of the session file tree. */
export const SessionFileEntry = z.object({
  /** Relative path with `/` separators, e.g. `src/index.ts`. */
  path: z.string().min(1),
  kind: z.enum(["file", "dir"]),
  sizeBytes: z.int().nonnegative().optional(),
});
export type SessionFileEntry = z.infer<typeof SessionFileEntry>;

/**
 * `GET /api/sessions/:id/files`: every file and folder under the session's working directory,
 * depth-first and sorted (folders first). `.git` and `node_modules` are skipped.
 */
export const SessionFileList = z.object({
  /** Absolute working directory the paths are relative to. */
  root: z.string(),
  entries: z.array(SessionFileEntry),
  /** True when the listing was cut off at the entry limit. */
  truncated: z.boolean(),
});
export type SessionFileList = z.infer<typeof SessionFileList>;

/** `GET /api/sessions/:id/files/content` query. */
export const SessionFileQuery = z.object({ path: z.string().min(1).max(4096) });
export type SessionFileQuery = z.infer<typeof SessionFileQuery>;

/** A text file from the session's working directory. Binary files report `binary: true`. */
export const SessionFileContent = z.object({
  path: z.string(),
  content: z.string(),
  sizeBytes: z.int().nonnegative(),
  binary: z.boolean(),
  /** True when only the first part of a large file was returned. */
  truncated: z.boolean(),
});
export type SessionFileContent = z.infer<typeof SessionFileContent>;
