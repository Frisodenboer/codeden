import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ViewportArbiter } from "../src/realtime/browser-viewport";
import { AgentActivity } from "../src/services/browser/agent-activity";

const desk = { width: 460, height: 712, deviceScaleFactor: 2 };
const phone = { width: 390, height: 640, deviceScaleFactor: 3 };

describe("ViewportArbiter (who sizes the page)", () => {
  it("follows the first viewer; a later viewer doesn't resize the page under it", () => {
    const a = new ViewportArbiter();
    expect(a.report("desk", desk)).toBe(true);
    expect(a.ownerId).toBe("desk");
    expect(a.report("phone", phone)).toBe(false);
    expect(a.size).toEqual(desk);
    // The owner's own resizes go through.
    expect(a.report("desk", { ...desk, width: 900 })).toBe(true);
    expect(a.size?.width).toBe(900);
    // Unchanged reports are no-ops.
    expect(a.report("desk", { ...desk, width: 900 })).toBe(false);
  });

  it("hands the viewport to the viewer that claims it, and back", () => {
    const a = new ViewportArbiter();
    a.report("desk", desk);
    a.report("phone", phone);
    expect(a.report("phone", phone, true)).toBe(true);
    expect(a.ownerId).toBe("phone");
    expect(a.size).toEqual(phone);
    // The desktop panel resizing while the phone owns it changes nothing...
    expect(a.report("desk", { ...desk, width: 500 })).toBe(false);
    // ...until the desktop is focused again.
    expect(a.report("desk", { ...desk, width: 500 }, true)).toBe(true);
    expect(a.size?.width).toBe(500);
  });

  it("passes ownership to the most recent claimant when the owner leaves", () => {
    const a = new ViewportArbiter();
    a.report("one", desk);
    a.report("two", { ...desk, width: 600 });
    a.report("three", { ...desk, width: 700 });
    a.report("two", { ...desk, width: 600 }, true); // claimed: owner, ranks newest
    a.report("one", desk, true); // claimed later: owner
    expect(a.remove("one")).toBe(true);
    expect(a.ownerId).toBe("two");
    expect(a.size?.width).toBe(600);
    // Removing a non-owner changes nothing.
    expect(a.remove("three")).toBe(false);
    expect(a.remove("two")).toBe(false); // nobody left to follow: the page keeps its size
    expect(a.ownerId).toBeUndefined();
    expect(a.viewers).toBe(0);
  });

  it("without claims, ranks by first report", () => {
    const a = new ViewportArbiter();
    a.report("one", desk);
    a.report("two", { ...desk, width: 600 });
    a.report("three", { ...desk, width: 700 });
    a.report("two", { ...desk, width: 610 }); // a resize is not a claim
    a.remove("one");
    expect(a.ownerId).toBe("three");
  });
});

describe("AgentActivity", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("is acting during agent commands and for a short decay after the last one", async () => {
    const activity = new AgentActivity(1_000);
    const changes: Array<[string, boolean]> = [];
    activity.onChange((s, acting) => changes.push([s, acting]));

    let finish: () => void = () => {};
    const running = activity.track("s1", () => new Promise<void>((r) => (finish = r)));
    expect(activity.isActing("s1")).toBe(true);
    expect(changes).toEqual([["s1", true]]);
    finish();
    await running;
    await vi.advanceTimersByTimeAsync(500);
    // A second command inside the decay keeps one stretch of activity.
    await activity.track("s1", async () => {});
    await vi.advanceTimersByTimeAsync(900);
    expect(activity.isActing("s1")).toBe(true);
    await vi.advanceTimersByTimeAsync(200);
    expect(activity.isActing("s1")).toBe(false);
    expect(changes).toEqual([
      ["s1", true],
      ["s1", false],
    ]);
  });

  it("ends the activity after a failed command too", async () => {
    const activity = new AgentActivity(100);
    await expect(
      activity.track("s1", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await vi.advanceTimersByTimeAsync(150);
    expect(activity.isActing("s1")).toBe(false);
  });
});
