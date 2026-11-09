import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CheckGlyph } from "@/components/github/check-glyph";
import { ChecksBadge } from "@/components/github/github-bits";
import { checks } from "@/lib/api/mock/fixtures/github";
import {
  CHECK_STATES,
  checkLabel,
  checkState,
  checksBreakdown,
  summaryLabel,
  summaryState,
} from "@/lib/github-checks";

describe("checkState", () => {
  it("maps every unfinished check-run and commit status", () => {
    expect(checkState("in_progress", null)).toBe("running");
    expect(checkState("pending", null)).toBe("running");
    expect(checkState("queued", null)).toBe("queued");
    expect(checkState("waiting", null)).toBe("queued");
    expect(checkState("requested", null)).toBe("queued");
    expect(checkState("expected", null)).toBe("queued");
    expect(checkState("IN_PROGRESS", null)).toBe("running");
  });

  it("maps every completed conclusion", () => {
    const cases: Array<[string, string]> = [
      ["success", "passed"],
      ["failure", "failed"],
      ["error", "failed"],
      ["startup_failure", "failed"],
      ["skipped", "skipped"],
      ["neutral", "neutral"],
      ["cancelled", "cancelled"],
      ["timed_out", "timed_out"],
      ["action_required", "action_required"],
      ["stale", "stale"],
      ["SUCCESS", "passed"],
    ];
    for (const [conclusion, state] of cases) {
      expect(checkState("completed", conclusion)).toBe(state);
    }
  });

  it("treats an unknown or missing conclusion as failed", () => {
    expect(checkState("completed", "something_new")).toBe("failed");
    expect(checkState("completed", null)).toBe("failed");
  });

  it("gives every state a short human label without underscores", () => {
    expect(checkLabel("in_progress", null)).toBe("Running");
    expect(checkLabel("queued", null)).toBe("Queued");
    expect(checkLabel("completed", "success")).toBe("Passed");
    expect(checkLabel("completed", "failure")).toBe("Failed");
    expect(checkLabel("completed", "skipped")).toBe("Skipped");
    expect(checkLabel("completed", "cancelled")).toBe("Cancelled");
    expect(checkLabel("completed", "timed_out")).toBe("Timed out");
    expect(checkLabel("completed", "action_required")).toBe("Action required");
    for (const info of Object.values(CHECK_STATES)) expect(info.label).not.toMatch(/_/);
  });
});

describe("checks summary", () => {
  const mixed = checks([
    ["a", "success"],
    ["b", "skipped"],
    ["c", null],
    ["d", "queued"],
    ["e", "timed_out"],
  ]);

  it("counts checks by what they show", () => {
    expect(checksBreakdown(mixed.checks)).toEqual({
      passed: 1,
      failed: 1,
      running: 1,
      queued: 1,
      other: 1,
    });
  });

  it("sums up a PR's checks for the badge", () => {
    expect(summaryState(checks([]))).toBeNull();
    expect(summaryState(checks([["a", "success"]]))).toBe("passed");
    expect(summaryState(mixed)).toBe("failed");
    expect(
      summaryState(
        checks([
          ["a", "success"],
          ["b", null],
        ]),
      ),
    ).toBe("running");
    expect(
      summaryState(
        checks([
          ["a", "success"],
          ["b", "queued"],
        ]),
      ),
    ).toBe("queued");
    expect(summaryLabel(mixed)).toBe("2/5 checks passed, 1 failed, 1 running, 1 queued");
  });
});

describe("CheckGlyph", () => {
  const glyph = (c: HTMLElement) => c.querySelector("svg") as SVGElement;

  it("doesn't animate on first render or when the state is unchanged", () => {
    const { container, rerender } = render(<CheckGlyph state="passed" />);
    expect(glyph(container).dataset.finished).toBeUndefined();
    rerender(<CheckGlyph state="passed" />);
    expect(glyph(container).dataset.finished).toBeUndefined();
  });

  it("plays the finish animation once a running check passes or fails", () => {
    const { container, rerender } = render(<CheckGlyph state="running" />);
    expect(glyph(container).getAttribute("class")).toContain("motion-safe:animate-spin");
    rerender(<CheckGlyph state="passed" />);
    expect(glyph(container).dataset.finished).toBe("true");
    expect(glyph(container).getAttribute("class")).toContain("motion-safe:animate-check-pop");
    expect(container.querySelector("path")?.getAttribute("class")).toContain(
      "motion-safe:animate-check-draw",
    );

    const failing = render(<CheckGlyph state="queued" />);
    failing.rerender(<CheckGlyph state="failed" />);
    expect(glyph(failing.container).getAttribute("class")).toContain(
      "motion-safe:animate-check-shake",
    );
  });

  it("doesn't animate a change between two finished states", () => {
    const { container, rerender } = render(<CheckGlyph state="failed" />);
    rerender(<CheckGlyph state="passed" />);
    expect(glyph(container).dataset.finished).toBeUndefined();
  });
});

describe("ChecksBadge", () => {
  it("spins while a check runs and shows a progress bar", () => {
    const { container } = render(
      <ChecksBadge
        checks={checks([
          ["a", "success"],
          ["b", null],
        ])}
      />,
    );
    expect(container.querySelector("svg")?.dataset.checkState).toBe("running");
    expect(container.textContent).toContain("1/2");
    expect(container.querySelector("[aria-hidden]")).toBeTruthy();
  });

  it("shows a clean success state without the bar", () => {
    const { container } = render(<ChecksBadge checks={checks([["a", "success"]])} />);
    expect(container.querySelector("svg")?.dataset.checkState).toBe("passed");
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });
});
