import { NOTICE_BATCH_CODE, type Notice } from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NoticeBatchCard, noticeBatchOf } from "@/components/thread/cards/notice-cards";
import { UserMessage } from "@/components/thread/messages";
import { createFetcher } from "@/lib/api/http";
import { httpOrchestrationApi, httpSessionConflictApi } from "@/lib/api/http-orchestration";
import { foldDigest } from "@/lib/orchestration";
import { renderWithClient } from "./utils";

const ts = "2026-11-07T10:00:00.000Z";
const digest = [
  '<codeden_status scope="all projects" at="2026-11-07T10:00:00.000Z">',
  "## demo (p1)",
  "Running: none",
  "</codeden_status>",
].join("\n");
const updates = "Updates since your last turn:\n- (session.finished) [demo] Add README finished";
/** A PM message notice quoting several paragraphs, as the server renders it. */
const pmUpdates = [
  "Updates since your last turn:",
  '- (pm.message) [demo] Update from the PM of demo · "The picker session asked the user a question in the inbox.',
  "",
  "My recommendation: say yes if the user wants it. It's small and fits the same PR.",
  "",
  "I've told the session to carry on meanwhile, so the question isn't blocking it.\"",
].join("\n");
const userText =
  "In demo, the sidebar cuts off details when it is narrow.\n\nAlso, how does archiving work?";
const tagged = (list: string) => `<codeden_updates>\n${list}\n</codeden_updates>`;

describe("foldDigest", () => {
  it("splits the status digest and notices from what the sender wrote", () => {
    const folded = foldDigest(`${digest}\n\n${tagged(updates)}\n\nWhat's going on?`);
    expect(folded.status).toBe(digest);
    expect(folded.updates).toBe(updates);
    expect(folded.text).toBe("What's going on?");
    expect(folded.wake).toBe(false);
  });

  it("ends a delimited updates block at its closing tag, whatever the notices contain", () => {
    const folded = foldDigest(`${digest}\n\n${tagged(pmUpdates)}\n\n${userText}`);
    expect(folded.updates).toBe(pmUpdates);
    expect(folded.text).toBe(userText);
    // Quotes and blank lines in the sender's own text do not matter either.
    const quoted = 'Reply "yes"\n\nThen "carry on';
    expect(foldDigest(`${digest}\n\n${tagged(pmUpdates)}\n\n${quoted}`).text).toBe(quoted);
  });

  it("folds legacy single-paragraph updates at the first blank line", () => {
    const folded = foldDigest(`${digest}\n\n${updates}\n\nWhat's going on?`);
    expect(folded.updates).toBe(updates);
    expect(folded.text).toBe("What's going on?");
  });

  it("folds legacy updates whose quoted notice spans paragraphs", () => {
    // The shape that leaked the end of a PM message into the user's bubble.
    const folded = foldDigest(`${digest}\n\n${pmUpdates}\n\n${userText}`);
    expect(folded.status).toBe(digest);
    expect(folded.updates).toBe(pmUpdates);
    expect(folded.text).toBe(userText);
  });

  it("falls back to the first blank line when legacy quotes never balance", () => {
    const stray = 'Updates since your last turn:\n- (pm.message) [demo] Note · "a 5" screen"';
    const folded = foldDigest(`${stray}\n\nWhat now?`);
    expect(folded.updates).toBe(stray);
    expect(folded.text).toBe("What now?");
  });

  it("leaves ordinary messages alone and spots automatic wake-ups", () => {
    expect(foldDigest("Fix the flaky test")).toEqual({
      status: null,
      updates: null,
      text: "Fix the flaky test",
      wake: false,
    });
    const wake = foldDigest(
      `${digest}\n\n${updates}\n\nAutomatic wake-up for the updates above. Act on anything.`,
    );
    expect(wake.wake).toBe(true);
  });
});

describe("UserMessage", () => {
  it("folds the digest into a collapsed disclosure", () => {
    renderWithClient(
      <UserMessage
        item={{
          id: "u1",
          kind: "user_message",
          status: "completed",
          input: { text: `${digest}\n\nWhat's going on?`, attachments: [] },
        }}
      />,
    );
    expect(screen.getByText("What's going on?")).toBeTruthy();
    expect(screen.queryByText(/codeden_status/)).toBeNull();
    const toggle = screen.getByRole("button", { name: /Status sent to agent/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(screen.getByText(/Running: none/)).toBeTruthy();
  });

  it("shows only the sender's text for a legacy multi-paragraph PM update", () => {
    renderWithClient(
      <UserMessage
        item={{
          id: "u2",
          kind: "user_message",
          status: "completed",
          input: { text: `${digest}\n\n${pmUpdates}\n\n${userText}`, attachments: [] },
        }}
      />,
    );
    expect(screen.queryByText(/carry on meanwhile/)).toBeNull();
    expect(screen.getByText(/the sidebar cuts off details/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Status sent to agent.*· 1 update$/ })).toBeTruthy();
  });

  it("keeps a wake-up with attachments as a bubble with its thumbnails", () => {
    const { client } = renderWithClient(
      <UserMessage
        item={{
          id: "u3",
          kind: "user_message",
          status: "completed",
          input: {
            text: `${digest}\n\n${tagged(updates)}\n\nAutomatic wake-up for the updates above.`,
            attachments: [
              {
                type: "image",
                mediaType: "image/png",
                name: "image.png",
                source: { type: "artifact", artifactId: "art-1" },
              },
            ],
          },
        }}
      />,
    );
    expect(screen.queryByTestId("wake-line")).toBeNull();
    const img = screen.getByRole("img", { name: "image.png" });
    expect(img.getAttribute("src")).toBe(client.artifactUrl("art-1"));
    expect(screen.queryByText(/codeden_updates/)).toBeNull();
  });
});

const finished: Notice = {
  id: "n1",
  type: "session.finished",
  projectId: null,
  target: "orchestrator",
  sessionId: "s1",
  title: "Add README finished",
  createdAt: ts,
  deliveredAt: ts,
  data: {
    sessionId: "s1",
    workKey: "request:readme",
    purpose: "Add README",
    startedBy: { kind: "pm" },
    summary: "README added with a test",
    outcome: "success",
  },
};

describe("notice cards", () => {
  it("reads typed notices from the batch item and renders them as cards", async () => {
    const notices = noticeBatchOf({
      id: "notices-t1",
      kind: "notice",
      status: "completed",
      level: "info",
      code: NOTICE_BATCH_CODE,
      message: "1 update since the last turn",
      data: { notices: [finished] },
    });
    expect(notices).toHaveLength(1);
    renderWithClient(<NoticeBatchCard notices={notices ?? []} />, undefined, { withRouter: true });
    expect(await screen.findByText("Add README finished")).toBeTruthy();
    expect(screen.getByText("README added with a test")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Session/ }).getAttribute("href")).toBe("/sessions/s1");
  });

  it("shows an orchestrator message the loop guard held back, linked to the orchestrator", async () => {
    const held: Notice = {
      id: "orchestrator.message:1",
      type: "orchestrator.message",
      projectId: null,
      target: "pm",
      sessionId: "orch1",
      title: "Message from the orchestrator",
      createdAt: ts,
      deliveredAt: ts,
      data: { fromSessionId: "orch1", text: "Please add a changelog entry" },
    };
    renderWithClient(<NoticeBatchCard notices={[held]} />, undefined, { withRouter: true });
    expect(await screen.findByText("From the orchestrator")).toBeTruthy();
    expect(screen.getByText("Please add a changelog entry")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Session/ }).getAttribute("href")).toBe(
      "/sessions/orch1",
    );
  });

  it("shows a wake-up the PM scheduled, with its note", async () => {
    const reminder: Notice = {
      id: "reminder:1",
      type: "reminder",
      projectId: null,
      target: "pm",
      sessionId: null,
      title: "Wake-up you scheduled",
      createdAt: ts,
      deliveredAt: ts,
      notBefore: ts,
      data: { note: "Check whether the audit finished", requestedBy: "pm1" },
    };
    renderWithClient(<NoticeBatchCard notices={[reminder]} />, undefined, { withRouter: true });
    expect(await screen.findByText("Wake-up")).toBeTruthy();
    expect(screen.getByText("Check whether the audit finished")).toBeTruthy();
  });
});

describe("http orchestration api", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("calls the orchestration, conflict and session routes", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({
          url,
          method: init.method ?? "GET",
          body: init.body && JSON.parse(String(init.body)),
        });
        const json = url.endsWith("/messages")
          ? { sessionId: "s-orch", status: "sent" }
          : url.includes("/conflicts?")
            ? []
            : {};
        return new Response(JSON.stringify(json), { status: 200 });
      }),
    );
    const http = createFetcher("http://127.0.0.1:1", () => {});
    const orchestration = httpOrchestrationApi(http);
    await orchestration.send("orchestrator", null, { text: "hi" });
    await orchestration.send("pm", "p1", { text: "hey" }, "steer");
    await httpSessionConflictApi(http).listConflicts({ projectId: "p1" });
    await waitFor(() => expect(calls).toHaveLength(3));
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", "http://127.0.0.1:1/api/orchestration/orchestrator/messages"],
      ["POST", "http://127.0.0.1:1/api/orchestration/projects/p1/pm/messages"],
      ["GET", "http://127.0.0.1:1/api/conflicts?projectId=p1"],
    ]);
    expect(calls[1]?.body).toEqual({ input: { text: "hey" }, whenBusy: "steer" });
  });
});
