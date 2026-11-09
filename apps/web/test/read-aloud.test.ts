import {
  READ_ALOUD_FULL_MAX_CHARS,
  READ_ALOUD_SUMMARY_MAX_CHARS,
  Settings,
  type SpeechSummaryResponse,
} from "@codeden/contracts";
import { describe, expect, it, vi } from "vitest";
import { readAloudText } from "@/lib/voice/read-aloud";
import { SPEAKER_TITLE_MAX_CHARS, speakerName, withSpeaker } from "@/lib/voice/speaker";

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

describe("speakerName", () => {
  it("names each role from the session, deterministically", () => {
    expect(speakerName({ role: "orchestrator", title: "Daily standup" }, null)).toBe(
      "Orchestrator",
    );
    expect(speakerName({ role: "pm", title: "Project manager" }, "codeden")).toBe(
      "codeden project manager",
    );
    expect(speakerName({ role: "agent", title: "Improve FAQ" }, "codeden-website")).toBe(
      "codeden-website, Improve FAQ",
    );
  });

  it("copes with missing projects and titles", () => {
    expect(speakerName({ role: "pm", title: null }, null)).toBe("Project manager");
    expect(speakerName({ role: "agent", title: null }, "codeden")).toBe("codeden agent");
    expect(speakerName({ role: "agent", title: "  " }, null)).toBe("Agent");
    expect(speakerName({ role: "agent", title: "Fix login." }, null)).toBe("Fix login");
  });

  it("cuts long titles at a word", () => {
    const name = speakerName(
      {
        role: "agent",
        title: "Rewrite the read-aloud pipeline so that it queues messages, and much more",
      },
      "codeden",
    );
    expect(name).toBe("codeden, Rewrite the read-aloud pipeline so that");
    expect(name.length - "codeden, ".length).toBeLessThanOrEqual(SPEAKER_TITLE_MAX_CHARS);
  });

  it("prefixes the spoken text in both modes", async () => {
    const c = client({ text: "Fixed it; nothing needs you.", source: "utility" });
    const tldr = await readAloudText(c, settings("summary"), REPORT);
    expect(withSpeaker("codeden project manager", tldr)).toBe(
      "codeden project manager: Fixed it; nothing needs you.",
    );
    const full = await readAloudText(c, settings("full"), "**Done.** All green.");
    expect(withSpeaker("Orchestrator", full)).toBe("Orchestrator: Done. All green.");
  });
});
