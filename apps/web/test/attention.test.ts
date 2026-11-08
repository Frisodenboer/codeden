import type { EventEnvelope, InboxItem, Settings, Snapshot } from "@codeden/contracts";
import { describe, expect, it } from "vitest";
import { type AttentionEffects, createAttention } from "@/lib/attention/attention";
import { attentionTarget, isOpenBlocking } from "@/lib/attention/blocking";
import { applyDomainEvent } from "@/lib/snapshot-reducer";
import { created, fakeEffects, inboxItem, snapshot, updated } from "./attention-fixtures";

/**
 * Drive the attention logic the way the app does: apply each live event to the snapshot, hand
 * the event to `onEvent`, then `sync` with the new snapshot.
 */
function harness(
  initial: InboxItem[] = [],
  opts: {
    notifications?: Partial<Settings["notifications"]>;
    effects?: AttentionEffects;
    focused?: boolean;
  } = {},
) {
  const effects = opts.effects ?? fakeEffects();
  let clock = 1_000_000;
  let focused = opts.focused ?? true;
  let snap: Snapshot = snapshot(10, initial, opts.notifications);
  const attention = createAttention(effects, { now: () => clock });
  attention.sync(snap, focused);
  let seq = snap.seq;
  return {
    effects,
    attention,
    get snap() {
      return snap;
    },
    advance(ms: number) {
      clock += ms;
    },
    focus(next: boolean) {
      focused = next;
      attention.sync(snap, focused);
    },
    emit(make: (seq: number) => EventEnvelope) {
      seq += 1;
      const env = make(seq);
      snap = applyDomainEvent(snap, env);
      attention.onEvent(env, snap);
      attention.sync(snap, focused);
      return env;
    },
    arrive(item: InboxItem) {
      this.emit((s) => created(s, item));
    },
    close(item: InboxItem, status: "resolved" | "dismissed" = "resolved") {
      this.emit((s) => updated(s, { ...item, status }));
    },
  };
}

describe("blocking items", () => {
  it("are open approvals and questions only", () => {
    expect(isOpenBlocking(inboxItem("a", "approval"))).toBe(true);
    expect(isOpenBlocking(inboxItem("q", "question"))).toBe(true);
    expect(isOpenBlocking(inboxItem("a", "approval", { status: "resolved" }))).toBe(false);
    for (const kind of [
      "pr_review",
      "run_failed",
      "triage",
      "automation_result",
      "message",
      "conflict",
    ] as const) {
      expect(isOpenBlocking(inboxItem("x", kind))).toBe(false);
    }
  });

  it("open on their session, or the inbox without one", () => {
    expect(attentionTarget(inboxItem("a", "approval", { sessionId: "s9" }))).toEqual({
      to: "/sessions/$sessionId",
      params: { sessionId: "s9" },
    });
    expect(attentionTarget(inboxItem("a", "question", { sessionId: null }))).toEqual({
      to: "/inbox",
    });
  });
});

describe("attention chime", () => {
  it("plays for approvals and questions, never for informational items", () => {
    const h = harness();
    for (const kind of [
      "pr_review",
      "run_failed",
      "triage",
      "automation_result",
      "message",
      "conflict",
    ] as const) {
      h.arrive(inboxItem(`i-${kind}`, kind));
      h.advance(10_000);
    }
    expect(h.effects.chime).not.toHaveBeenCalled();
    expect(h.effects.showToast).not.toHaveBeenCalled();

    h.arrive(inboxItem("a1", "approval"));
    expect(h.effects.chime).toHaveBeenCalledTimes(1);
    h.advance(10_000);
    h.arrive(inboxItem("q1", "question"));
    expect(h.effects.chime).toHaveBeenCalledTimes(2);
  });

  it("plays once for a burst within about 3 seconds", () => {
    const h = harness();
    h.arrive(inboxItem("a1", "approval"));
    h.advance(500);
    h.arrive(inboxItem("a2", "approval"));
    h.advance(1500);
    h.arrive(inboxItem("q1", "question"));
    expect(h.effects.chime).toHaveBeenCalledTimes(1);
    // Every item still gets its own sticky toast.
    expect(h.effects.showToast).toHaveBeenCalledTimes(3);
    h.advance(3000);
    h.arrive(inboxItem("a3", "approval"));
    expect(h.effects.chime).toHaveBeenCalledTimes(2);
  });

  it("never plays for items that were open when the page loaded", () => {
    const existing = inboxItem("old", "approval");
    const h = harness([existing]);
    // A duplicate created event for a known item (e.g. replayed) stays silent.
    h.emit((s) => created(s, existing));
    expect(h.effects.chime).not.toHaveBeenCalled();
    expect(h.effects.showToast).not.toHaveBeenCalled();
    h.arrive(inboxItem("new", "approval"));
    expect(h.effects.chime).toHaveBeenCalledTimes(1);
  });

  it("knows the load-time items even when an event comes before the first sync", () => {
    const effects = fakeEffects();
    const attention = createAttention(effects);
    const existing = inboxItem("old", "question");
    const fresh = inboxItem("new", "approval");
    // The cache already holds the new item when its event is handed over.
    const snap = snapshot(11, [existing, fresh]);
    attention.onEvent(created(11, fresh), snap);
    attention.onEvent(created(12, existing), snap);
    expect(effects.chime).toHaveBeenCalledTimes(1);
    expect(effects.showToast).toHaveBeenCalledWith(fresh, { offerNotifications: false });
  });

  it("stays quiet with the sound setting off, but still shows the toast", () => {
    const h = harness([], { notifications: { sound: false } });
    h.arrive(inboxItem("a1", "approval"));
    expect(h.effects.chime).not.toHaveBeenCalled();
    expect(h.effects.showToast).toHaveBeenCalledTimes(1);
  });

  it("still chimes with toasts off, without a toast", () => {
    const h = harness([], { notifications: { toasts: false } });
    h.arrive(inboxItem("a1", "approval"));
    expect(h.effects.chime).toHaveBeenCalledTimes(1);
    expect(h.effects.showToast).not.toHaveBeenCalled();
  });
});

describe("sticky toast", () => {
  it("is dismissed when its item is resolved elsewhere", () => {
    const a1 = inboxItem("a1", "approval");
    const q1 = inboxItem("q1", "question");
    const h = harness();
    h.arrive(a1);
    h.arrive(q1);
    expect(h.effects.dismissToast).not.toHaveBeenCalled();
    h.close(a1);
    expect(h.effects.dismissToast).toHaveBeenCalledTimes(1);
    expect(h.effects.dismissToast).toHaveBeenCalledWith("a1");
    h.close(q1, "dismissed");
    expect(h.effects.dismissToast).toHaveBeenLastCalledWith("q1");
    // Later snapshots don't dismiss again.
    h.arrive(inboxItem("p", "pr_review"));
    expect(h.effects.dismissToast).toHaveBeenCalledTimes(2);
  });

  it("survives a stale snapshot but not a newer one that dropped the item", () => {
    const effects = fakeEffects();
    const attention = createAttention(effects);
    const a1 = inboxItem("a1", "approval");
    attention.sync(snapshot(10, []), true);
    attention.onEvent(created(11, a1), snapshot(11, [a1]));
    attention.sync(snapshot(10, []), true);
    expect(effects.dismissToast).not.toHaveBeenCalled();
    // A reloaded snapshot (resync) that only lists open items.
    attention.sync(snapshot(20, []), true);
    expect(effects.dismissToast).toHaveBeenCalledWith("a1");
  });

  it("offers desktop notifications in one toast at a time", () => {
    const effects = fakeEffects(true);
    const h = harness([], { effects });
    const a1 = inboxItem("a1", "approval");
    h.arrive(a1);
    h.arrive(inboxItem("a2", "approval"));
    expect(effects.showToast).toHaveBeenNthCalledWith(1, a1, { offerNotifications: true });
    expect(effects.showToast.mock.calls[1]?.[1]).toEqual({ offerNotifications: false });
    // Once that toast closes unanswered, the next blocking item may carry the offer.
    h.close(a1);
    h.arrive(inboxItem("a3", "approval"));
    expect(effects.showToast.mock.calls[2]?.[1]).toEqual({ offerNotifications: true });
  });

  it("makes no offer when it may not", () => {
    const h = harness();
    h.arrive(inboxItem("a1", "approval"));
    expect(h.effects.showToast).toHaveBeenCalledWith(expect.anything(), {
      offerNotifications: false,
    });
  });
});

describe("favicon and title cues", () => {
  it("badge the favicon while any blocking item is open", () => {
    const a1 = inboxItem("a1", "approval");
    const h = harness();
    expect(h.effects.setFavicon).toHaveBeenLastCalledWith(false);
    h.arrive(inboxItem("p", "pr_review"));
    expect(h.effects.setFavicon).toHaveBeenLastCalledWith(false);
    h.arrive(a1);
    expect(h.effects.setFavicon).toHaveBeenLastCalledWith(true);
    h.close(a1);
    expect(h.effects.setFavicon).toHaveBeenLastCalledWith(false);
  });

  it("badge items already open at load, without a chime", () => {
    const h = harness([inboxItem("old", "question")]);
    expect(h.effects.setFavicon).toHaveBeenLastCalledWith(true);
    expect(h.effects.chime).not.toHaveBeenCalled();
  });

  it("flash the title only while unfocused, keeping the open count", () => {
    const a1 = inboxItem("a1", "approval");
    const h = harness([inboxItem("p", "pr_review")]);
    h.arrive(a1);
    expect(h.effects.setTitle).toHaveBeenLastCalledWith({ count: 2, flashing: false });
    h.focus(false);
    expect(h.effects.setTitle).toHaveBeenLastCalledWith({ count: 2, flashing: true });
    h.close(a1);
    expect(h.effects.setTitle).toHaveBeenLastCalledWith({ count: 1, flashing: false });
  });
});
