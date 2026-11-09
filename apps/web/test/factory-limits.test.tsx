import type { Project } from "@codeden/contracts";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";
import { AutonomyDialog } from "@/components/factory/autonomy-dialog";
import { createMockClient } from "@/lib/api/mock";
import { projects } from "@/lib/api/mock/fixtures/world";
import { renderWithClient } from "./utils";

const storefront = projects.find((p) => p.id === "p-storefront") as Project;

describe("factory merge-check limits in the autonomy dialog", () => {
  it("shows the size limits and saves an empty box as no limit", async () => {
    const success = vi.spyOn(toast, "success").mockImplementation(() => "t");
    const client = createMockClient();
    const setMode = vi.spyOn(client.factory, "setMode");
    renderWithClient(<AutonomyDialog project={storefront} open onOpenChange={() => {}} />, client, {
      withRouter: true,
    });

    const lines = (await screen.findByLabelText("Largest change (lines)")) as HTMLInputElement;
    await waitFor(() => expect(lines.value).toBe("5000"));
    const files = screen.getByLabelText("Most files changed") as HTMLInputElement;
    expect(files.value).toBe("");
    expect(files.placeholder).toBe("No limit");
    expect(screen.getByText(/Lockfiles and generated files don't count/)).toBeTruthy();

    fireEvent.change(lines, { target: { value: "" } });
    fireEvent.change(files, { target: { value: "120" } });
    fireEvent.click(screen.getByRole("button", { name: "Save limits" }));

    await waitFor(() => expect(setMode).toHaveBeenCalled());
    expect(setMode.mock.calls[0]?.[1]).toMatchObject({
      mode: "autopilot",
      tuning: { maxChangedLines: null, maxChangedFiles: 120, requireCi: true },
    });
    success.mockRestore();
  });
});
