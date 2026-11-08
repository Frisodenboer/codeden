import {
  type InboxItem,
  type ItemRecord,
  QueuedMessageList,
  StartSessionResponse,
} from "@codeden/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type Harness, startHarness, waitUntil } from "./support/harness";

let h: Harness;

beforeAll(async () => {
  h = await startHarness();
});

afterAll(async () => {
  await h?.close();
});

/** Start a Fake session that waits on an approval, so messages queue behind its turn. */
async function waitingSession(): Promise<string> {
  const started = StartSessionResponse.parse(
    (
      await h.api("POST", "/sessions", {
        projectId: h.projectId,
        provider: "fake",
        purpose: `Hold ${Math.random()}`,
        input: { text: "hold on [approval]" },
      })
    ).body,
  );
  if (started.status !== "started") throw new Error(`not started: ${started.status}`);
  await waitUntil(async () =>
    (await h.detail(started.sessionId)).session.status === "waiting" ? true : undefined,
  );
  return started.sessionId;
}

const queue = async (id: string) =>
  QueuedMessageList.parse((await h.api("GET", `/sessions/${id}/queue`)).body).messages;
const texts = async (id: string) => (await queue(id)).map((m) => m.input.text);
const send = (id: string, text: string) =>
  h.api("POST", `/sessions/${id}/messages`, { input: { text } });

describe("queued messages over HTTP", () => {
  it("lists, edits, deletes and sends now; delivery then wins any race with 409", async () => {
    const id = await waitingSession();
    for (const text of ["one", "two", "three"]) {
      expect((await send(id, text)).body).toEqual({ status: "queued" });
    }
    await h.server.services.sessions.send(
      id,
      { input: { text: "four", attachments: [] }, whenBusy: "queue" },
      "pm",
    );
    const listed = await queue(id);
    expect(listed.map((m) => [m.input.text, m.from])).toEqual([
      ["one", "user"],
      ["two", "user"],
      ["three", "user"],
      ["four", "pm"],
    ]);
    const [one, two, three, four] = listed.map((m) => m.id);

    const edited = await h.api("PATCH", `/sessions/${id}/queue/${one}`, { text: "one, edited" });
    expect(edited.status).toBe(200);
    expect((edited.body as { input: { text: string } }).input.text).toBe("one, edited");
    expect((await h.api("PATCH", `/sessions/${id}/queue/${one}`, { text: " " })).status).toBe(400);

    expect((await h.api("DELETE", `/sessions/${id}/queue/${two}`)).body).toEqual({ ok: true });
    const again = await h.api("DELETE", `/sessions/${id}/queue/${two}`);
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ error: { code: "no_longer_queued" } });
    await h.api("DELETE", `/sessions/${id}/queue/${four}`);

    // Send now steers the waiting turn (the Fake provider can steer).
    const now = await h.api("POST", `/sessions/${id}/queue/${three}/send-now`);
    expect(now.body).toEqual({ status: "steered" });
    expect(await texts(id)).toEqual(["one, edited"]);
    expect((await h.detail(id)).queuedMessages).toBe(1);

    // Approve: the turn ends and delivery sends the edited text.
    const inbox = (await h.api("GET", `/inbox?sessionId=${id}`)).body as InboxItem[];
    const approval = inbox.find((i) => i.kind === "approval");
    await h.api("POST", `/inbox/${approval?.id}/resolve`, {
      response: { kind: "approval", decision: "allow_once" },
    });
    await waitUntil(async () => ((await texts(id)).length === 0 ? true : undefined));
    const late = await h.api("PATCH", `/sessions/${id}/queue/${one}`, { text: "too late" });
    expect(late.status).toBe(409);
    expect(late.body).toMatchObject({ error: { code: "already_sent" } });

    const done = await waitUntil(async () => {
      const d = await h.detail(id);
      return d.session.status === "idle" ? d : undefined;
    });
    const root = done.session.rootThreadId as string;
    const page = await h.api("GET", `/sessions/${id}/threads/${encodeURIComponent(root)}/items`);
    const sent = (page.body as { items: ItemRecord[] }).items.flatMap((r) =>
      r.item.kind === "user_message" ? [r.item.input.text] : [],
    );
    expect(sent).toEqual(["hold on [approval]", "three", "one, edited"]);
  });

  it("an interrupt drops the queue", async () => {
    const id = await waitingSession();
    await send(id, "never mind");
    const [message] = await queue(id);
    await h.api("POST", `/sessions/${id}/interrupt`);
    expect(await texts(id)).toEqual([]);
    const gone = await h.api("DELETE", `/sessions/${id}/queue/${message?.id}`);
    expect(gone.status).toBe(409);
    await h.api("POST", `/sessions/${id}/stop`);
  });
});
