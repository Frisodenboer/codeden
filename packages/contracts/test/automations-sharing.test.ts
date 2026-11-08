import { describe, expect, it } from "vitest";
import {
  AUTOMATION_IMPORT_LIMITS,
  Automation,
  AutomationExport,
  AutomationImportPreviewResponse,
  AutomationImportSource,
  DuplicateAutomationRequest,
  ExportAutomationsResponse,
  ImportAutomationsRequest,
} from "../src";
import { sampleAutomation } from "./fixtures";

const roundTrip = <T>(schema: { parse(v: unknown): T }, value: unknown) => {
  const parsed = schema.parse(value);
  expect(schema.parse(JSON.parse(JSON.stringify(parsed)))).toEqual(parsed);
  return parsed;
};

const draft = {
  name: "Release notes",
  description: null,
  trigger: { type: "cron", expression: "0 16 * * 5" },
  action: { type: "start_session", prompt: "Draft them", autonomy: "full" },
  guards: {
    overlapPolicy: "skip-if-running",
    maxConcurrent: 1,
    maxPerDay: null,
    quietHours: null,
    catchUpMissed: false,
  },
  workKey: "automation:release-notes",
};

describe("sharing automations (§10)", () => {
  it("keeps automations without createdBy valid and round-trips the creator", () => {
    expect(Automation.parse(sampleAutomation).createdBy).toBeUndefined();
    expect(roundTrip(Automation, { ...sampleAutomation, createdBy: "pm" }).createdBy).toBe("pm");
    expect(Automation.safeParse({ ...sampleAutomation, createdBy: "robot" }).success).toBe(false);
  });

  it("round-trips import sources, previews and requests", () => {
    roundTrip(AutomationImportSource, { files: [{ name: "a.md", content: "---" }] });
    roundTrip(AutomationImportSource, { text: "---\nname: x\n---" });
    expect(AutomationImportSource.safeParse({}).success).toBe(false);
    expect(AutomationImportSource.safeParse({ text: "  " }).success).toBe(false);
    const preview = roundTrip(AutomationImportPreviewResponse, {
      items: [
        { fileName: "a.md", automation: draft, error: null, fullPermissions: true },
        { fileName: "b.md", automation: null, error: "Invalid YAML", fullPermissions: false },
      ],
    });
    expect(preview.items).toHaveLength(2);
    roundTrip(ImportAutomationsRequest, {
      source: { zipBase64: "UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==" },
      projectId: "p1",
      select: ["a.md"],
    });
  });

  it("caps the number and size of imported files", () => {
    const files = Array.from({ length: AUTOMATION_IMPORT_LIMITS.maxFiles + 1 }, (_, i) => ({
      name: `${i}.md`,
      content: "x",
    }));
    expect(AutomationImportSource.safeParse({ files }).success).toBe(false);
    const big = "x".repeat(AUTOMATION_IMPORT_LIMITS.maxFileChars + 1);
    expect(AutomationImportSource.safeParse({ text: big }).success).toBe(false);
  });

  it("round-trips exports and duplicate requests", () => {
    roundTrip(AutomationExport, { fileName: "a.md", markdown: "---\nname: a\n---\nhi\n" });
    roundTrip(ExportAutomationsResponse, { fileName: "all.zip", zipBase64: "UEsF", count: 3 });
    roundTrip(DuplicateAutomationRequest, { projectId: "p1", name: "Copy" });
    expect(DuplicateAutomationRequest.parse({})).toEqual({});
  });
});
