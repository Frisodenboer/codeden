import {
  READ_ALOUD_FULL_MAX_CHARS,
  READ_ALOUD_SUMMARY_MAX_CHARS,
  Settings,
  type SpeechSummaryResponse,
} from "@codeden/contracts";
import { describe, expect, it, vi } from "vitest";
import { readAloudText } from "@/lib/voice/read-aloud";

const REPORT = [
  "## Summary",
  "",
  ...Array.from({ length: 20 }, (_, i) => `- Changed \`file${i}.ts\` and verified it works.`),
  "",
  "```ts",
  "const secret = 1;",
  "```",
].join("\n");

const settings = (content: "summary" | "full") =>
  Settings.parse({ voice: { readAloud: { enabled: true, content } } });

function client(reply: SpeechSummaryResponse | Error) {
  const speechSummary = vi.fn(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  });
  return { speechSummary };
}

describe("readAloudText", () => {
  it("speaks the TL;DR for a long message in summary mode", async () => {
    const c = client({ text: "I changed twenty files; nothing needs you.", source: "utility" });
    expect(await readAloudText(c, settings("summary"), REPORT)).toBe(
      "I changed twenty files; nothing needs you.",
    );
    expect(c.speechSummary).toHaveBeenCalledWith(REPORT);
  });

  it("speaks short messages as they are, without a summary call", async () => {
    const c = client(new Error("unused"));
    expect(await readAloudText(c, settings("summary"), "**Done.** Tests pass.")).toBe(
      "Done. Tests pass.",
    );
    expect(c.speechSummary).not.toHaveBeenCalled();
  });

  it("falls back to the first sentences, never the report, when the summary fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const text = await readAloudText(client(new Error("offline")), settings("summary"), REPORT);
    expect(text.length).toBeLessThanOrEqual(READ_ALOUD_SUMMARY_MAX_CHARS);
    expect(text.startsWith("Summary Changed file0.ts and verified it works.")).toBe(true);
    expect(text).not.toContain("file19");
  });

  it("caps a long summary from the server", async () => {
    const c = client({ text: "word ".repeat(300), source: "utility" });
    const text = await readAloudText(c, settings("summary"), REPORT);
    expect(text.length).toBeLessThanOrEqual(READ_ALOUD_SUMMARY_MAX_CHARS);
  });

  it("reads the whole stripped message in full mode, without a summary call", async () => {
    const c = client(new Error("unused"));
    const text = await readAloudText(c, settings("full"), REPORT);
    expect(text).toContain("Changed file19.ts and verified it works.");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("#");
    expect(c.speechSummary).not.toHaveBeenCalled();
    const huge = await readAloudText(c, settings("full"), "A sentence here. ".repeat(1_000));
    expect(huge.length).toBeLessThanOrEqual(READ_ALOUD_FULL_MAX_CHARS);
  });
});
