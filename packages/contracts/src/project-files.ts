import { z } from "zod";

/**
 * The project file manager: browse and manage the files of a project's main checkout
 * (`project.path`). Listing and reading reuse the session file shapes (`SessionFileList`,
 * `SessionFileContent`, `SessionFileQuery`). Paths are relative to the project folder and use
 * `/` separators; nothing outside the folder and nothing inside `.git` can be changed.
 */

const RelPath = z.string().min(1).max(4096);

/** `POST /api/projects/:id/files/ops`: one change to the project folder. */
export const ProjectFileOp = z.discriminatedUnion("op", [
  /** Create an empty file; fails if something already exists at `path`. */
  z.object({ op: z.literal("createFile"), path: RelPath }),
  /** Create a folder (and missing parents); fails if something already exists at `path`. */
  z.object({ op: z.literal("createDir"), path: RelPath }),
  /** Rename or move a file or folder; fails if `to` already exists. */
  z.object({ op: z.literal("rename"), from: RelPath, to: RelPath }),
  /** Delete a file or a folder with everything in it. */
  z.object({ op: z.literal("delete"), path: RelPath }),
]);
export type ProjectFileOp = z.infer<typeof ProjectFileOp>;

export const ProjectFileOpResponse = z.object({
  ok: z.literal(true),
  /** The path the change produced (the new path for a rename), `/` separators. */
  path: z.string(),
});
export type ProjectFileOpResponse = z.infer<typeof ProjectFileOpResponse>;
