import type { ItemOf } from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VoiceButton } from "@/components/composer/voice-button";
import { ConflictCard } from "@/components/project/conflict-card";
import { ApprovalCard } from "@/components/thread/cards/approval-card";
import { QuestionCard } from "@/components/thread/cards/question-card";
import { WorkGroup } from "@/components/thread/work/work-group";
import { createMockClient } from "@/lib/api/mock";
import { conflicts } from "@/lib/api/mock/fixtures/sessions";
import type { WorkEntry } from "@/lib/transcript/timeline";
import type { SpeechToText } from "@/lib/voice/engines";
import { renderWithClient } from "./utils";

const approval: ItemOf<"approval_request"> = {
  id: "ap",
  kind: "approval_request",
  status: "in_progress",
  requestId: "req-1",
  action: "git_destructive",
  title: "Force push to main",
  reason: "Rewrites history",
  command: "git push --force",
  options: ["allow_once", "allow_session", "deny"],
};

describe("ApprovalCard", () => {
  it("sends the chosen decision", async () => {
    const client = createMockClient();
    const respond = vi.spyOn(client, "respond").mockResolvedValue();
    renderWithClient(<ApprovalCard item={approval} sessionId="s1" />, client);
    expect(screen.getByText("Force push to main")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Always allow this session/ }));
    await waitFor(() =>
      expect(respond).toHaveBeenCalledWith("s1", "req-1", {
        kind: "approval",
        decision: "allow_session",
      }),
    );
  });

  it("shows the decision once resolved", () => {
    renderWithClient(
      <ApprovalCard item={{ ...approval, status: "declined", decision: "deny" }} sessionId="s1" />,
    );
    expect(screen.getByText("Denied")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });
});

describe("QuestionCard", () => {
  it("collects options and free text, then answers", async () => {
    const client = createMockClient();
    const respond = vi.spyOn(client, "respond").mockResolvedValue();
    const item: ItemOf<"user_question"> = {
      id: "q",
      kind: "user_question",
      status: "in_progress",
      requestId: "req-q",
      questions: [
        {
          id: "a",
          question: "Strategy?",
          options: [{ label: "Backoff" }, { label: "Fixed" }],
          multiSelect: false,
          allowFreeText: false,
        },
        { id: "b", question: "Then?", options: [], multiSelect: false, allowFreeText: true },
      ],
    };
    renderWithClient(<QuestionCard item={item} sessionId="s1" />, client);
    const send = screen.getByRole("button", { name: "Send answer" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Backoff/ }));
    fireEvent.change(screen.getByPlaceholderText(/your own answer/), {
      target: { value: "Dead-letter it" },
    });
    fireEvent.click(send);
    await waitFor(() =>
      expect(respond).toHaveBeenCalledWith("s1", "req-q", {
        kind: "answer",
        answers: { a: ["Backoff"], b: ["Dead-letter it"] },
      }),
    );
  });
});

describe("WorkGroup", () => {
  const entries: WorkEntry[] = [
    {
      id: "1",
      kind: "tool_call",
      toolKind: "file_read",
      status: "completed",
      toolName: "Read",
      path: "src/a.ts",
    },
    {
      id: "2",
      kind: "tool_call",
      toolKind: "command",
      status: "completed",
      toolName: "Bash",
      command: "pnpm test",
      output: { text: "ok", truncated: false },
      exitCode: 0,
    },
  ];

  it("collapses into a summary and expands on click", () => {
    renderWithClient(<WorkGroup entries={entries} live={false} />);
    expect(screen.getByText("Ran 1 command and read 1 file")).toBeTruthy();
    expect(screen.queryByText("src/a.ts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { expanded: false, name: /Ran 1 command/ }));
    expect(screen.getByText("src/a.ts")).toBeTruthy();
  });

  it("shows the running step while live", () => {
    const live: WorkEntry[] = [
      ...entries,
      {
        id: "3",
        kind: "tool_call",
        toolKind: "command",
        status: "in_progress",
        toolName: "Bash",
        command: "pnpm build",
      },
    ];
    renderWithClient(<WorkGroup entries={live} live />);
    expect(screen.getAllByText("pnpm build").length).toBeGreaterThan(0);
  });
});

describe("ConflictCard", () => {
  it("offers wait, join, skip and force", async () => {
    const client = createMockClient();
    const resolve = vi.spyOn(client, "resolveConflict").mockResolvedValue();
    const conflict = conflicts[0];
    if (!conflict) throw new Error("fixture missing");
    renderWithClient(<ConflictCard conflict={conflict} />, client, { withRouter: true });
    fireEvent.click(await screen.findByRole("button", { name: /Join/ }));
    await waitFor(() =>
      expect(resolve).toHaveBeenCalledWith("cf-audit", {
        resolution: "join",
        sessionId: "s-audit",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Force/ }));
    const start = screen.getByRole("button", { name: "Start anyway" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });
});

describe("VoiceButton", () => {
  it("is disabled when speech recognition is unsupported", () => {
    const engine: SpeechToText = { supported: false, start: vi.fn(), stop: vi.fn() };
    renderWithClient(<VoiceButton baseText="" onText={() => {}} engine={engine} />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });

  it("streams dictated text after the existing draft", () => {
    let handlers: Parameters<SpeechToText["start"]>[0] | undefined;
    const engine: SpeechToText = { supported: true, start: (o) => (handlers = o), stop: vi.fn() };
    const onText = vi.fn();
    renderWithClient(<VoiceButton baseText="Fix" onText={onText} engine={engine} />);
    fireEvent.click(screen.getByRole("button"));
    handlers?.onText("the flaky test", true);
    expect(onText).toHaveBeenCalledWith("Fix the flaky test");
    expect(screen.getByRole("button").getAttribute("aria-pressed")).toBe("true");
  });
});
