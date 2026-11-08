import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ItemRecord, RawEventEnvelope, UserInput } from "@codeden/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Database, openDatabase } from "../src/db/client";
import { EventStore } from "../src/events/store";
import { ArtifactService } from "../src/services/artifacts";
import { clientEvent, clientInput, clientItemRecord } from "../src/services/sessions/client-items";
import { sampleSession } from "./helpers";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

let dir: string;
let artifactsDir: string;
let database: Database;
let store: EventStore;
let artifacts: ArtifactService;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "codeden-attach-"));
  artifactsDir = join(dir, "artifacts");
  database = openDatabase(join(dir, "codeden.db"));
  store = new EventStore(database.db);
  store.append([{ type: "session.created", sessionId: "s1", payload: { session: sampleSession } }]);
  artifacts = new ArtifactService(database.db, store, artifactsDir);
});

afterEach(() => {
  database.close();
  rmSync(dir, { recursive: true, force: true });
});

const pasted: UserInput = {
  text: "look at this",
  attachments: [
    {
      type: "image",
      mediaType: "image/png",
      name: "image.png",
      source: { type: "base64", data: PNG_B64 },
    },
    { type: "file", path: "src/app.ts", name: "app.ts" },
  ],
};
const owner = { sessionId: "s1", projectId: null };

/** The input as the old code stored it: the image pointing at the artifact's absolute path. */
function legacyInput(): { input: UserInput; artifactId: string; path: string } {
  const artifact = artifacts.save({
    bytes: Buffer.from(PNG_B64, "base64"),
    name: "image.png",
    mediaType: "image/png",
    kind: "image",
    sessionId: "s1",
  });
  const path = artifacts.filePath(artifact);
  return {
    artifactId: artifact.id,
    path,
    input: {
      text: "legacy",
      attachments: [
        {
          type: "image",
          mediaType: "image/png",
          name: "image.png",
          source: { type: "path", path },
        },
      ],
    },
  };
}

const record = (input: UserInput): ItemRecord => ({
  sessionId: "s1",
  threadId: "t1",
  turnId: "u1",
  position: 0,
  createdAt: "2026-11-08T10:00:00.000Z",
  updatedAt: "2026-11-08T10:00:00.000Z",
  item: { id: "i1", kind: "user_message", status: "completed", input },
});

describe("attachment externalize / resolve", () => {
  it("stores pasted images as artifact references, never as a path or inline data", () => {
    const stored = artifacts.externalizeAttachments(pasted, owner);
    const image = stored.attachments[0];
    expect(image?.type === "image" && image.source.type).toBe("artifact");
    expect(stored.attachments[1]).toEqual(pasted.attachments[1]);
    const json = JSON.stringify(stored);
    expect(json).not.toContain(PNG_B64);
    expect(json).not.toContain(dir.replace(/\\/g, "\\\\"));
    expect(json).not.toContain(dir);
    // Already stored input passes through untouched.
    expect(artifacts.externalizeAttachments(stored, owner)).toBe(stored);
  });

  it("resolves artifacts to their file for the runner, and maps that path back", () => {
    const stored = artifacts.externalizeAttachments(pasted, owner);
    const resolved = artifacts.resolveAttachments(stored);
    const image = resolved.attachments[0];
    if (image?.type !== "image" || image.source.type !== "path") throw new Error("not a path");
    expect(existsSync(image.source.path)).toBe(true);
    expect(readFileSync(image.source.path).toString("base64")).toBe(PNG_B64);
    expect(image.source.path.startsWith(artifactsDir)).toBe(true);

    // The provider echoes the resolved input back; the browser sees the artifact again.
    const storedImage = stored.attachments[0];
    const id =
      storedImage?.type === "image" && storedImage.source.type === "artifact"
        ? storedImage.source.artifactId
        : undefined;
    expect(artifacts.artifactForPath(image.source.path)?.id).toBe(id);
    expect(clientInput(resolved, artifacts)).toEqual(stored);
  });

  it("rejects an unknown artifact instead of handing the runner nothing", () => {
    const input: UserInput = {
      text: "x",
      attachments: [
        { type: "image", mediaType: "image/png", source: { type: "artifact", artifactId: "nope" } },
      ],
    };
    expect(() => artifacts.resolveAttachments(input)).toThrow(/No artifact nope/);
  });
});

describe("legacy path attachments", () => {
  it("maps a path inside the artifacts folder back to its artifact", () => {
    const { input, artifactId, path } = legacyInput();
    expect(artifacts.artifactForPath(path)?.id).toBe(artifactId);
    const shown = clientItemRecord(record(input), artifacts);
    const image = shown.item.kind === "user_message" ? shown.item.input.attachments[0] : undefined;
    expect(image).toEqual({
      type: "image",
      mediaType: "image/png",
      name: "image.png",
      source: { type: "artifact", artifactId },
    });
  });

  it("only matches the artifact's own file inside the artifacts folder", () => {
    const { artifactId, path } = legacyInput();
    const outside = join(dir, "elsewhere", "s1", `${artifactId}.png`);
    expect(artifacts.artifactForPath(outside)).toBeUndefined();
    expect(
      artifacts.artifactForPath(join(artifactsDir, "s2", `${artifactId}.png`)),
    ).toBeUndefined();
    expect(artifacts.artifactForPath(join(artifactsDir, "s1", "other.png"))).toBeUndefined();
    expect(artifacts.artifactForPath(`${path}.png`)).toBeUndefined();
    if (process.platform === "win32") {
      const shouting = path.replace(artifactsDir, artifactsDir.toUpperCase());
      expect(artifacts.artifactForPath(shouting)?.id).toBe(artifactId);
    }
  });
});

describe("no filesystem path reaches the client", () => {
  it("keeps only the file name of an image path that is not an artifact", () => {
    const foreign = join(dir, "private", "photo.png");
    const input: UserInput = {
      text: "x",
      attachments: [
        { type: "image", mediaType: "image/png", source: { type: "path", path: foreign } },
      ],
    };
    const shown = clientItemRecord(record(input), artifacts);
    const json = JSON.stringify(shown);
    expect(json).toContain("photo.png");
    expect(json).not.toContain("private");
  });

  it("maps user messages in streamed agent events as well", () => {
    const { input, artifactId, path } = legacyInput();
    const event: RawEventEnvelope = {
      seq: 1,
      sessionId: "s1",
      type: "agent.item.completed",
      ts: "2026-11-08T10:00:00.000Z",
      payload: { type: "item.completed", threadId: "t1", turnId: "u1", item: record(input).item },
    };
    const json = JSON.stringify(clientEvent(event, artifacts));
    expect(json).toContain(artifactId);
    expect(json).not.toContain(JSON.stringify(path).slice(1, -1));
    const other: RawEventEnvelope = { ...event, type: "session.updated", payload: {} };
    expect(clientEvent(other, artifacts)).toBe(other);
  });

  it("leaves records without path images as they are", () => {
    const plain = record({ text: "hi", attachments: [] });
    expect(clientItemRecord(plain, artifacts)).toBe(plain);
  });
});
