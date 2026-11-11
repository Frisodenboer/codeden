import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AttentionToast,
  dismissAttentionToast,
  showAttentionToast,
} from "@/components/shell/attention-toast";
import { createAttention } from "@/lib/attention/attention";
import { applyDomainEvent } from "@/lib/snapshot-reducer";
import { created, inboxItem, snapshot, updated } from "./attention-fixtures";

const handlers = () => ({
  onOpen: vi.fn(),
  onEnableNotifications: vi.fn(async () => true),
  onDeclineNotifications: vi.fn(),
});

describe("AttentionToast", () => {
  it("shows what is waiting with an Open action", () => {
    const h = handlers();
    render(
      <AttentionToast
        item={inboxItem("a1", "approval", { title: "Force push to main" })}
        offerNotifications={false}
        onDismiss={vi.fn()}
        {...h}
      />,
    );
    expect(screen.getByText("Approval needed")).toBeTruthy();
    expect(screen.getByText("Force push to main")).toBeTruthy();
    expect(screen.queryByText(/Get notified/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(h.onOpen).toHaveBeenCalledTimes(1);
  });

  it("offers desktop notifications and confirms when turned on", async () => {
    const h = handlers();
    render(
      <AttentionToast
        item={inboxItem("q1", "question")}
        offerNotifications
        onDismiss={vi.fn()}
        {...h}
      />,
    );
    expect(screen.getByText("Question from an agent")).toBeTruthy();
    expect(screen.getByText("Get notified when CodeBench is in the background")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(await screen.findByText("Desktop notifications are on.")).toBeTruthy();
    expect(h.onEnableNotifications).toHaveBeenCalledTimes(1);
  });

  it("hides the offer after Not now", () => {
    const h = handlers();
    render(
      <AttentionToast
        item={inboxItem("q1", "question")}
        offerNotifications
        onDismiss={vi.fn()}
        {...h}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(h.onDeclineNotifications).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Get notified/)).toBeNull();
  });
});

describe("sticky toast in the toaster", () => {
  afterEach(() => {
    act(() => {
      dismissAttentionToast("a1");
      dismissAttentionToast("a2");
    });
  });

  it("goes away when opened", async () => {
    render(<Toaster />);
    const h = handlers();
    act(() => showAttentionToast(inboxItem("a1", "approval"), { offerNotifications: false, ...h }));
    fireEvent.click(await screen.findByRole("button", { name: "Open" }));
    expect(h.onOpen).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId("attention-toast")).toBeNull());
  });

  it("is dismissed when the item resolves", async () => {
    render(<Toaster />);
    const h = handlers();
    const attention = createAttention({
      chime: vi.fn(),
      showToast: (item, opts) => showAttentionToast(item, { ...opts, ...h }),
      dismissToast: dismissAttentionToast,
      setFavicon: vi.fn(),
      setTitle: vi.fn(),
      canOfferNotifications: () => false,
    });
    let snap = snapshot(1, []);
    attention.sync(snap, true);
    const emit = (env: ReturnType<typeof created>) => {
      snap = applyDomainEvent(snap, env);
      act(() => {
        attention.onEvent(env, snap);
        attention.sync(snap, true);
      });
    };
    const a2 = inboxItem("a2", "approval", { title: "Delete the build cache" });
    emit(created(2, a2));
    expect(await screen.findByText("Delete the build cache")).toBeTruthy();
    emit(updated(3, { ...a2, status: "resolved" }));
    await waitFor(() => expect(screen.queryByText("Delete the build cache")).toBeNull());
  });
});
