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

describe("foldDigest", () => {
  it("splits the status digest and notices from what the sender wrote", () => {
    const folded = foldDigest(`${digest}\n\n${updates}\n\nWhat's going on?`);
    expect(folded.status).toBe(digest);
    expect(folded.updates).toBe(updates);
    expect(folded.text).toBe("What's going on?");
    expect(folded.wake).toBe(false);
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
