import { describe, expect, it } from "vitest";
import { entryLabel } from "../src/components/thread/work/tool-meta";
import type { WorkEntry } from "../src/lib/transcript/timeline";

describe("work entry labels after the turn ended", () => {
  const thinking = {
    kind: "reasoning",
    status: "in_progress",
    summary: "",
  } as unknown as WorkEntry;
  it("reads as Thinking while the turn runs", () => {
    expect(entryLabel(thinking).verb).toBe("Thinking");
  });
  it("reads as Thought once the turn was interrupted", () => {
    expect(entryLabel(thinking, false).verb).toBe("Thought");
  });
});
