import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AutomationForm } from "@/components/automations/automation-form";
import {
  type AutomationDraft,
  blankDraft,
  draftProblems,
  toCreateRequest,
  toUpdateRequest,
} from "@/components/automations/draft";
import { ImportDialog, readImportFiles } from "@/components/automations/import-dialog";
import { PermissionsField } from "@/components/automations/permissions-field";
import { createMockClient } from "@/lib/api/mock";
import { renderWithClient } from "./utils";

const toast = vi.hoisted(() =>
  Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }),
);
vi.mock("sonner", () => ({ toast }));

function Harness({ onDraft }: { onDraft: (d: AutomationDraft) => void }) {
  const [draft, setDraft] = useState(blankDraft("auto"));
  return (
    <AutomationForm
      draft={draft}
      onChange={(d) => {
        setDraft(d);
        onDraft(d);
      }}
      projectTimezone="UTC"
      defaultAutonomy="auto"
      docKey="test"
      defaultWorkKey="automation:<name>"
    />
  );
}

describe("the automation editor", () => {
  it("starts on weekdays at 09:00 with a plain summary and the next runs", async () => {
    const onDraft = vi.fn();
    renderWithClient(<Harness onDraft={onDraft} />);
    expect(screen.getByTestId("schedule-summary").textContent).toBe("Every weekday at 09:00");
    expect(screen.getByTestId("cron-preview").textContent).toMatch(/Next: .+·.+·/);
    fireEvent.click(screen.getByRole("button", { name: /Only when I run it/ }));
    expect(onDraft).toHaveBeenLastCalledWith(
      expect.objectContaining({ trigger: { type: "manual" } }),
    );
    expect(screen.queryByTestId("schedule-picker")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /When something happens/ }));
    expect(onDraft.mock.lastCall?.[0].trigger).toEqual({
      type: "event",
      event: "pr.checks_failed",
    });
  });

  it("sets permissions and warns about Full", () => {
    const onDraft = vi.fn();
    renderWithClient(<Harness onDraft={onDraft} />);
    const field = screen.getByTestId("permissions-field");
    fireEvent.click(within(field).getByRole("button", { name: /Read-only/ }));
    expect(onDraft.mock.lastCall?.[0].action.autonomy).toBe("read_only");
    fireEvent.click(within(field).getByRole("button", { name: /Full/ }));
    expect(screen.getByText(/Full never asks before acting/)).toBeTruthy();
  });

  it("disables Read-only for a provider that can't enforce it", () => {
    renderWithClient(
      <PermissionsField value="auto" onChange={() => {}} readOnlySupported={false} />,
    );
    const readOnly = screen.getByRole("button", { name: /Read-only/ }) as HTMLButtonElement;
    expect(readOnly.disabled).toBe(true);
    expect(readOnly.textContent).toMatch(/can't enforce/);
  });

  it("says what is missing and builds create and update requests", () => {
    const draft = blankDraft("read_only");
    expect(draftProblems(draft, "UTC")).toEqual(["Give it a name.", "Write the prompt."]);
    const ready: AutomationDraft = {
      ...draft,
      name: "  Nightly  ",
      action: { type: "start_session", prompt: "Check", autonomy: "read_only" },
      trigger: { type: "cron", expression: " 0 2 * * * " },
    };
    expect(draftProblems(ready, "UTC")).toEqual([]);
    expect(
      draftProblems({ ...ready, trigger: { type: "cron", expression: "nope" } }, "UTC"),
    ).toEqual(["Fix the schedule."]);
    expect(toCreateRequest(ready, "p1", false)).toMatchObject({
      projectId: "p1",
      name: "Nightly",
      trigger: { expression: "0 2 * * *" },
      enabled: false,
    });
    expect(toUpdateRequest({ ...ready, target: "all_projects" }, "p1")).toMatchObject({
      target: { type: "all_projects" },
      workKey: null,
    });
  });
});

const RELEASE = `---
name: Release notes draft
trigger:
  type: cron
  expression: "0 16 * * 5"
autonomy: full
---
Draft the release notes for {{project.name}}.`;

describe("importing automations", () => {
  it("reads .md files as text and a .zip as base64, within the limits", async () => {
    const md = new File([RELEASE], "release.md", { type: "text/markdown" });
    const zip = new File([new Uint8Array([80, 75, 5, 6])], "all.zip", { type: "application/zip" });
    const source = await readImportFiles([md, zip]);
    expect(source.files).toEqual([{ name: "release.md", content: RELEASE }]);
    expect(source.zipBase64).toBe(btoa(String.fromCharCode(80, 75, 5, 6)));
    await expect(readImportFiles([zip, zip])).rejects.toThrow(/one .zip/);
    const big = new File(["x".repeat(200 * 1024)], "big.md");
    await expect(readImportFiles([big])).rejects.toThrow(/too large/);
  });

  it("previews pasted Markdown, warns about Full and imports it off", async () => {
    const client = createMockClient();
    renderWithClient(<ImportDialog projectId="p-storefront" />, client);
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    const dialog = await screen.findByTestId("import-dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Paste" }));
    fireEvent.change(within(dialog).getByLabelText("Automation Markdown"), {
      target: { value: RELEASE },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Preview" }));
    const row = await within(dialog).findByTestId("import-preview-row");
    expect(row.textContent).toContain("Release notes draft");
    expect(row.textContent).toContain("Every Friday at 16:00");
    expect(row.textContent).toMatch(/Full permissions/);
    expect(within(dialog).getByText(/would act without asking/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: /Import 1 of 1, off/ }));
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Imported 1 automation, all off", {
        description: undefined,
      }),
    );
    const list = await client.automations.list("p-storefront");
    const imported = list.automations.find((i) => i.automation.name === "Release notes draft");
    expect(imported?.automation).toMatchObject({ enabled: false, createdBy: "import" });
  });
});
