import { existsSync } from "node:fs";
import {
  type Attachment,
  type ItemRecord,
  type QueuedMessage,
  RoleMessageResponse,
  StartSessionResponse,
} from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness, TOKEN, waitUntil } from "./support/harness";
import { TestWsClient } from "./support/ws-client";

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pastedImage: Attachment = {
  type: "image",
  mediaType: "image/png",
  name: "image.png",
  source: { type: "base64", data: PNG_B64 },
};

let h: Harness;
let ws: TestWsClient;

beforeAll(async () => {
  h = await startHarness();
  ws = await TestWsClient.connect(h.server.url, TOKEN);
  // Everything a client can ask for, agent events included.
  ws.send({ type: "subscribe", fromSeq: h.server.store.headSeq(), agentEvents: true });
});

afterAll(async () => {
  ws?.close();
  await h?.close();
});

/** True when `text` mentions the artifacts folder in any JSON-escaped spelling. */
function mentionsArtifactsDir(text: string): boolean {
  const dir = h.server.paths.artifacts;
  return [dir, JSON.stringify(dir).slice(1, -1), dir.replace(/\\/g, "/")].some((d) =>
    text.toLowerCase().includes(d.toLowerCase()),
  );
}

const userMessages = (records: ItemRecord[]) =>
  records.flatMap((r) => (r.item.kind === "user_message" ? [r.item] : []));

describe("pasted images in a session", () => {
  it("are handed to the provider as a file and shown to the browser as the artifact", async () => {
    const started = StartSessionResponse.parse(
      (
        await h.api("POST", "/sessions", {
          projectId: h.projectId,
          provider: "fake",
          purpose: "Look at a screenshot",
          input: { text: "what is in this image?", attachments: [pastedImage] },
        })
      ).body,
    );
    if (started.status !== "started") throw new Error(`not started: ${started.status}`);
    const id = started.sessionId;
    ws.send({ type: "watch_session", sessionId: id, fromSeq: 0 });
    const done = await waitUntil(async () => {
      const d = await h.detail(id);
      return d.session.status === "idle" ? d : undefined;
    });
    const root = done.session.rootThreadId as string;

    // The runner got a real file inside the artifacts folder (the Fake provider echoes it).
    const stored = h.server.services.sessionRepo.threadPage(id, root, { limit: 50 });
    const echoed = userMessages(stored.items)[0]?.input.attachments[0];
    if (echoed?.type !== "image" || echoed.source.type !== "path") throw new Error("no path");
    expect(existsSync(echoed.source.path)).toBe(true);

    // The browser sees the artifact, which loads.
    const page = await h.api("GET", `/sessions/${id}/threads/${encodeURIComponent(root)}/items`);
    const shown = userMessages((page.body as { items: ItemRecord[] }).items)[0]?.input
      .attachments[0];
    if (shown?.type !== "image" || shown.source.type !== "artifact") throw new Error("no artifact");
    const res = await fetch(`${h.server.url}/api/artifacts/${shown.source.artifactId}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer()).toString("base64")).toBe(PNG_B64);

    // No filesystem path in any response the browser gets: thread page, whole-session
    // snapshot, live transcript and the event stream.
    const snapshot = await h.api("GET", `/sessions/${id}/snapshot`);
    await ws.waitFor((m) => m.type === "transcript" && m.sessionId === id && m.items.length > 0);
    expect(mentionsArtifactsDir(JSON.stringify(page.body))).toBe(false);
    expect(mentionsArtifactsDir(JSON.stringify(snapshot.body))).toBe(false);
    expect(mentionsArtifactsDir(JSON.stringify(ws.messages))).toBe(false);
    expect(JSON.stringify(ws.messages)).toContain(shown.source.artifactId);
  });

  it("queue as artifact references while a turn waits, then deliver as files", async () => {
    const started = StartSessionResponse.parse(
      (
        await h.api("POST", "/sessions", {
          projectId: h.projectId,
          provider: "fake",
          purpose: "Wait for approval",
          input: { text: "edit something [approval]" },
        })
      ).body,
    );
    if (started.status !== "started") throw new Error(`not started: ${started.status}`);
    const id = started.sessionId;
    await waitUntil(async () =>
      (await h.detail(id)).session.status === "waiting" ? true : undefined,
    );

    const sent = await h.api("POST", `/sessions/${id}/messages`, {
      input: { text: "and this one", attachments: [pastedImage] },
    });
    expect(sent.body).toEqual({ status: "queued" });
    const queued = h.server.store
      .listAfter(0, 10_000, [id])
      .find((e) => e.type === "message.queued")?.payload as { message: QueuedMessage } | undefined;
    const image = queued?.message.input.attachments[0];
    expect(image?.type === "image" && image.source.type).toBe("artifact");
    expect(mentionsArtifactsDir(JSON.stringify(queued))).toBe(false);
  });

  it("reach a PM that the first message starts", async () => {
    const sent = RoleMessageResponse.parse(
      (
        await h.api("POST", `/orchestration/projects/${h.projectId}/pm/messages`, {
          input: { text: "what is in this screenshot?", attachments: [pastedImage] },
        })
      ).body,
    );
    const id = sent.sessionId;
    // The new PM starts first, then its queued first message runs.
    const message = await waitUntil(async () => {
      const d = await h.detail(id);
      if (d.session.status !== "idle" || !d.session.rootThreadId) return undefined;
      const root = encodeURIComponent(d.session.rootThreadId);
      const page = await h.api("GET", `/sessions/${id}/threads/${root}/items`);
      return userMessages((page.body as { items: ItemRecord[] }).items)[0];
    });
    expect(message.input.text.endsWith("what is in this screenshot?")).toBe(true);
    const shown = message.input.attachments[0];
    if (shown?.type !== "image" || shown.source.type !== "artifact") throw new Error("no artifact");
    const res = await fetch(`${h.server.url}/api/artifacts/${shown.source.artifactId}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(Buffer.from(await res.arrayBuffer()).toString("base64")).toBe(PNG_B64);
  });
});
