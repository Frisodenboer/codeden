import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Artifact, ArtifactKind, UserInput } from "@codeden/contracts";
import { and, desc, eq, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { rowToArtifact } from "../db/rows";
import { artifacts } from "../db/schema";
import type { EventStore } from "../events/store";
import { badRequest, notFound } from "./errors";
import { resolveInside } from "./files/path-guard";

const EXTENSIONS: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "text/plain": ".txt",
};

/** Max size of one pasted attachment. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export interface SaveArtifactInput {
  bytes: Buffer;
  name: string;
  mediaType: string;
  kind: ArtifactKind;
  projectId?: string | null;
  sessionId?: string | null;
}

/** Files under `<home>/artifacts` (§6): screenshots, pasted images, full tool outputs. */
export class ArtifactService {
  constructor(
    private readonly db: Db,
    private readonly store: EventStore,
    private readonly dir: string,
  ) {}

  save(input: SaveArtifactInput): Artifact {
    const id = randomUUID();
    const folder = input.sessionId ?? "shared";
    const relative = `${folder}/${id}${EXTENSIONS[input.mediaType] ?? ""}`;
    const absolute = resolveInside(this.dir, relative);
    mkdirSync(join(this.dir, folder), { recursive: true });
    writeFileSync(absolute, input.bytes);
    const artifact: Artifact = {
      id,
      kind: input.kind,
      name: input.name,
      mediaType: input.mediaType,
      path: relative,
      sizeBytes: input.bytes.length,
      sha256: createHash("sha256").update(input.bytes).digest("hex"),
      projectId: input.projectId ?? null,
      sessionId: input.sessionId ?? null,
      threadId: null,
      itemId: null,
      createdAt: new Date().toISOString(),
    };
    this.store.append([
      { type: "artifact.created", sessionId: artifact.sessionId, payload: { artifact } },
    ]);
    return artifact;
  }

  get(id: string): Artifact {
    const row = this.db.select().from(artifacts).where(eq(artifacts.id, id)).get();
    if (!row) throw notFound(`No artifact ${id}`, "artifact_not_found");
    return rowToArtifact(row);
  }

  list(filter: { sessionId?: string; projectId?: string } = {}): Artifact[] {
    const conditions: SQL[] = [];
    if (filter.sessionId) conditions.push(eq(artifacts.sessionId, filter.sessionId));
    if (filter.projectId) conditions.push(eq(artifacts.projectId, filter.projectId));
    return this.db
      .select()
      .from(artifacts)
      .where(and(...conditions))
      .orderBy(desc(artifacts.createdAt))
      .limit(500)
      .all()
      .map(rowToArtifact);
  }

  /** Absolute path of an artifact's file, guaranteed to be inside the artifacts folder. */
  filePath(artifact: Artifact): string {
    return resolveInside(this.dir, artifact.path);
  }

  /**
   * Store pasted (base64) images as artifacts and point the attachment at the file, so large
   * payloads never land in the event log. The runner reads the file by path.
   */
  externalizeAttachments(input: UserInput, owner: { sessionId: string; projectId: string | null }) {
    const attachments = input.attachments.map((a) => {
      if (a.type !== "image" || a.source.type !== "base64") return a;
      const bytes = Buffer.from(a.source.data, "base64");
      if (bytes.length > MAX_ATTACHMENT_BYTES) {
        throw badRequest("Attachment is larger than 20 MB", "attachment_too_large");
      }
      const artifact = this.save({
        bytes,
        name: a.name ?? `pasted${EXTENSIONS[a.mediaType] ?? ""}`,
        mediaType: a.mediaType,
        kind: "image",
        ...owner,
      });
      return { ...a, source: { type: "path" as const, path: this.filePath(artifact) } };
    });
    return { ...input, attachments };
  }
}
