import { describe, expect, it } from "vitest";
import { entryLabel } from "@/components/thread/work/tool-meta";
import { outputSummary, SUMMARY_MAX } from "@/components/thread/work/tool-summary";
import type { WorkEntry } from "@/lib/transcript/timeline";

describe("outputSummary", () => {
  it("returns nothing for missing, empty or blank output", () => {
    expect(outputSummary(undefined)).toBeUndefined();
    expect(outputSummary("")).toBeUndefined();
    expect(outputSummary("  \n\t\n ")).toBeUndefined();
  });

  it("uses the first non-empty line of plain text, with whitespace collapsed", () => {
    expect(outputSummary("\n\n  Progress   recorded.  \nsecond line")).toBe("Progress recorded.");
    expect(outputSummary("[INFO] server ready\nlistening on 4318")).toBe("[INFO] server ready");
  });

  it("picks the first descriptive field of a JSON object", () => {
    expect(outputSummary('{"ok":true,"message":"Issue triaged","id":"x1"}')).toBe("Issue triaged");
    expect(outputSummary('{"title":"Fix login","summary":"Done: 3 files"}')).toBe("Done: 3 files");
    expect(outputSummary('{\n  "status": "open",\n  "number": 3\n}')).toBe("open");
  });

  it("looks inside a single wrapping key", () => {
    const json = JSON.stringify({
      issue: { projectId: "a72f9074", number: 3, title: "Discover the model list", state: "open" },
    });
    expect(outputSummary(json)).toBe("Discover the model list");
  });

  it("counts the items of a JSON array", () => {
    expect(outputSummary('[{"id":1},{"id":2},{"id":3}]')).toBe("3 items");
    expect(outputSummary('{"sessions":[{"id":1}]}')).toBe("1 item");
    expect(outputSummary("[]")).toBe("0 items");
  });

  it("shows JSON scalars as they are", () => {
    expect(outputSummary('["Saved."]')).toBe("1 item");
    expect(outputSummary('{"result":"Saved."}')).toBe("Saved.");
    expect(outputSummary("42")).toBe("42");
  });

  it("shows nothing for JSON without a descriptive field, or cut-off JSON", () => {
    expect(outputSummary('{"ok":true,"id":"abc"}')).toBeUndefined();
    expect(outputSummary('{"a":{"b":1},"c":2}')).toBeUndefined();
    expect(outputSummary('{"issue":{"projectId":"a72f9074","title":"Disc')).toBeUndefined();
    expect(outputSummary('[{"id":1},{"id":')).toBeUndefined();
  });

  it("caps very long summaries with an ellipsis", () => {
    const long = `${"word ".repeat(200)}end`;
    const plain = outputSummary(long);
    expect(Array.from(plain ?? "")).toHaveLength(SUMMARY_MAX);
    expect(plain?.endsWith("…")).toBe(true);
    expect(plain?.startsWith("word word")).toBe(true);

    const token = "x".repeat(5000);
    const fromJson = outputSummary(JSON.stringify({ issue: { title: token, body: token } }));
    expect(fromJson).toBe(`${"x".repeat(SUMMARY_MAX - 1)}…`);
    expect(outputSummary("short", 3)).toBe("sh…");
    expect(outputSummary("abc", 3)).toBe("abc");
  });
});

describe("entryLabel for MCP tools", () => {
  const mcp = (text?: string): WorkEntry => ({
    id: "m1",
    kind: "tool_call",
    toolKind: "mcp",
    status: "completed",
    toolName: "mcp__codeden__triage_issue",
    server: "codeden",
    tool: "triage_issue",
    title: "codeden: triage_issue",
    output: text === undefined ? undefined : { text, truncated: false },
  });

  it("summarises the output instead of showing raw JSON", () => {
    const json = JSON.stringify({ issue: { number: 3, title: "Ship it", url: "https://x" } });
    expect(entryLabel(mcp(json))).toEqual({ verb: "codeden: triage_issue", meta: "Ship it" });
    expect(entryLabel(mcp()).meta).toBeUndefined();
  });
});
