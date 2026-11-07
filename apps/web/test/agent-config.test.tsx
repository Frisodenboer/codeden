import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { McpServers } from "@/components/agents/mcp-servers";
import { PatchView } from "@/components/agents/patch-dialog";
import { LoadedConfig } from "@/components/workbench/loaded-config";
import { createMockClient } from "@/lib/api/mock";
import { renderWithClient } from "./utils";

describe("McpServers", () => {
  it("lists servers and removes one after a diff preview", async () => {
    const client = createMockClient();
    const diffMcp = vi.spyOn(client.agentConfig, "diffMcp");
    const removeMcp = vi.spyOn(client.agentConfig, "removeMcp");
    renderWithClient(<McpServers projectId="p-storefront" />, client);
    expect(await screen.findByText("playwright")).toBeTruthy();
    // CodeDen's own server is read-only.
    expect(screen.queryByRole("button", { name: "Remove codeden" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Remove linear" }));
    await waitFor(() =>
      expect(diffMcp).toHaveBeenCalledWith({ provider: "claude", scope: "user", name: "linear" }),
    );
    const confirm = (await screen.findByRole("button", {
      name: "Remove server",
    })) as HTMLButtonElement;
    await waitFor(() => expect(confirm.disabled).toBe(false));
    expect(screen.getByTestId("patch-view").textContent).toContain("-");
    fireEvent.click(confirm);
    await waitFor(() => expect(removeMcp).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("linear")).toBeNull());
  });
});

describe("LoadedConfig", () => {
  it("shows memory, skills, subagents and MCP servers for a session", async () => {
    renderWithClient(<LoadedConfig sessionId="s1" projectId="p-storefront" />, createMockClient(), {
      withRouter: true,
    });
    expect(await screen.findByText("frontend-design")).toBeTruthy();
    expect(screen.getByText("code-reviewer")).toBeTruthy();
    expect(screen.getByText("CLAUDE.md")).toBeTruthy();
    expect(screen.getAllByText("built in").length).toBeGreaterThan(0);
  });
});

describe("PatchView", () => {
  it("renders every patch line", () => {
    renderWithClient(<PatchView patch={"--- a/x\n+++ b/x\n@@ -1 +1 @@\n-old\n+new\n"} />);
    expect(screen.getByText("-old")).toBeTruthy();
    expect(screen.getByText("+new")).toBeTruthy();
  });
});
