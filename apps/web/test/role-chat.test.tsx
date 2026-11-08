import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RoleChat, roleDraftKey } from "@/components/orchestration/role-chat";
import type { CodeDenClient } from "@/lib/api/client";
import { createMockClient } from "@/lib/api/mock";
import { getDraft, useComposerStore } from "@/stores/composer";
import { renderWithClient } from "./utils";

/** Browser speech recognition, installed before the voice engines load (they look it up once). */
const speech = vi.hoisted(() => {
  const state: { last: FakeRecognition | null } = { last: null };
  class FakeRecognition {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onend: (() => void) | null = null;
    start() {
      state.last = this;
    }
    stop() {
      this.onend?.();
    }
  }
  Object.assign(window, { SpeechRecognition: FakeRecognition });
  return state;
});

const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
const pastedImage = {
  type: "image",
  mediaType: "image/png",
  name: "image.png",
  source: { type: "base64", data: PNG_B64 },
};

type Send = CodeDenClient["orchestration"]["send"];

/**
 * The mock client on a fresh install: no orchestrator or PM session yet, so the first message
 * starts them. Dictation uses the browser engine in Afrikaans.
 */
function freshInstall(send: Send = vi.fn<Send>()): CodeDenClient {
  const client = createMockClient();
  return {
    ...client,
    getSnapshot: async () => {
      const s = await client.getSnapshot();
      s.settings.voice.dictation.engine = "browser";
      s.settings.voice.dictation.language = "af-ZA";
      return {
        ...s,
        sessions: s.sessions.filter((x) => x.role === "agent"),
        roleSessions: { orchestrator: null, pms: {} },
      };
    },
    orchestration: { ...client.orchestration, send },
  };
}

const sent = () =>
  vi.fn<Send>(async (role) => ({ sessionId: `s-${role}`, status: "sent" as const }));

/** Paste an image file into the composer the way the clipboard does. */
function pasteImage(target: HTMLElement) {
  const bytes = Uint8Array.from(atob(PNG_B64), (c) => c.charCodeAt(0));
  const file = new File([bytes], "image.png", { type: "image/png" });
  fireEvent.paste(target, { clipboardData: { files: [file] } });
}

beforeEach(() => {
  useComposerStore.setState({ drafts: {} });
  speech.last = null;
});

describe("RoleChat before the role session exists", () => {
  it("offers dictation with its shortcut, in the language from Settings", async () => {
    renderWithClient(
      <RoleChat kind="pm" projectId="p-storefront" empty={() => null} />,
      freshInstall(),
    );
    // The project name shows once the snapshot (and its settings) has loaded.
    await screen.findByText("Storefront · Project manager");
    expect(screen.getByTestId("role-chat-start")).toBeTruthy();
    expect(screen.getByText("The first message starts the PM.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Attach files" })).toBeTruthy();
    // "Dictate · <shortcut>" when the engine works (not "Dictation isn't available…").
    const mic = screen.getByRole("button", { name: /^Dictate · / });

    fireEvent.keyDown(window, {
      key: "M",
      code: "KeyM",
      ctrlKey: true,
      metaKey: true,
      shiftKey: true,
    });
    expect(mic.getAttribute("aria-pressed")).toBe("true");
    expect(speech.last?.lang).toBe("af-ZA");

    act(() =>
      speech.last?.onresult?.({
        resultIndex: 0,
        results: { length: 1, 0: { isFinal: true, 0: { transcript: "What is running?" } } },
      }),
    );
    const key = roleDraftKey("pm", "p-storefront");
    expect(getDraft(useComposerStore.getState(), key).text).toBe("What is running?");
    expect((screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement).value).toBe(
      "What is running?",
    );
  });

  it("attaches a pasted screenshot and sends it alone with Enter", async () => {
    const send = sent();
    renderWithClient(
      <RoleChat kind="orchestrator" projectId={null} empty={() => null} />,
      freshInstall(send),
    );
    expect(screen.getByText("The first message starts the orchestrator.")).toBeTruthy();
    const box = screen.getByRole("textbox", { name: "Message" });
    const button = screen.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);

    pasteImage(box);
    const thumbnail = await screen.findByRole("img", { name: "image.png" });
    expect(thumbnail.getAttribute("src")).toBe(`data:image/png;base64,${PNG_B64}`);
    expect(button.disabled).toBe(false);

    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith("orchestrator", null, {
      text: "",
      attachments: [pastedImage],
    });
    expect(screen.queryByRole("img", { name: "image.png" })).toBeNull();
  });

  it("sends a suggestion's text and a pasted image together as the PM's first message", async () => {
    const send = sent();
    renderWithClient(
      <RoleChat kind="pm" projectId="p-storefront" empty={() => null} />,
      freshInstall(send),
    );
    // Suggestion chips in the empty state write to the role draft key.
    act(() =>
      useComposerStore
        .getState()
        .setText(roleDraftKey("pm", "p-storefront"), "What is in this screenshot?"),
    );
    pasteImage(screen.getByRole("textbox", { name: "Message" }));
    await screen.findByRole("button", { name: "Remove image.png" });

    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith("pm", "p-storefront", {
      text: "What is in this screenshot?",
      attachments: [pastedImage],
    });
    expect(getDraft(useComposerStore.getState(), roleDraftKey("pm", "p-storefront"))).toEqual({
      text: "",
      attachments: [],
    });
  });
});
