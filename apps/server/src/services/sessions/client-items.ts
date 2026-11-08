import type {
  AgentEvent,
  Attachment,
  ItemRecord,
  RawEventEnvelope,
  UserInput,
} from "@codeden/contracts";
import { previewRecord } from "./preview";

/** Finds the artifact behind a file path (`ArtifactService.artifactForPath`). */
export interface ArtifactLookup {
  artifactForPath(path: string): { id: string } | undefined;
}

const isPathImage = (a: Attachment) => a.type === "image" && a.source.type === "path";

/** The last segment of a path, whichever separator it uses. */
const fileName = (path: string) => path.split(/[\\/]/).pop() || "image";

/**
 * Input as the browser sees it. Image attachments are handed to providers as file paths and
 * providers echo that input back, so a user message can hold a path into the artifacts folder
 * (older transcripts stored it that way too). Such a path becomes its artifact, which the UI
 * loads from `/api/artifacts/:id`; any other image path keeps only its file name, so no
 * filesystem path reaches the browser. Pure apart from the lookup.
 */
export function clientInput(input: UserInput, artifacts: ArtifactLookup): UserInput {
  if (!input.attachments.some(isPathImage)) return input;
  const attachments = input.attachments.map((a): Attachment => {
    if (a.type !== "image" || a.source.type !== "path") return a;
    const artifact = artifacts.artifactForPath(a.source.path);
    if (artifact) return { ...a, source: { type: "artifact" as const, artifactId: artifact.id } };
    return { ...a, source: { type: "path" as const, path: fileName(a.source.path) } };
  });
  return { ...input, attachments };
}

/** An item record as served to the browser: large outputs previewed, attachments mapped. */
export function clientItemRecord(record: ItemRecord, artifacts: ArtifactLookup): ItemRecord {
  const previewed = previewRecord(record);
  const { item } = previewed;
  if (item.kind !== "user_message" || !item.input.attachments.some(isPathImage)) return previewed;
  return { ...previewed, item: { ...item, input: clientInput(item.input, artifacts) } };
}

/** A stored event as streamed to the browser: agent items carry mapped attachments too. */
export function clientEvent(event: RawEventEnvelope, artifacts: ArtifactLookup): RawEventEnvelope {
  if (
    event.type !== "agent.item.started" &&
    event.type !== "agent.item.updated" &&
    event.type !== "agent.item.completed"
  ) {
    return event;
  }
  const payload = event.payload as AgentEvent;
  if (!("item" in payload) || payload.item.kind !== "user_message") return event;
  const { item } = payload;
  if (!item.input.attachments.some(isPathImage)) return event;
  return {
    ...event,
    payload: { ...payload, item: { ...item, input: clientInput(item.input, artifacts) } },
  };
}
