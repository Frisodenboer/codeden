import type { ModelInfo, ProviderInfo } from "@codeden/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  aliasFor,
  resolvedEfforts,
  resolveModel,
  triggerText,
} from "@/components/composer/model-picker/logic";
import { ModelPicker } from "@/components/composer/model-picker/model-picker";
import { createMockClient } from "@/lib/api/mock";
import { providers } from "@/lib/api/mock/fixtures/world";
import { snapshotKey, useSnapshotData } from "@/lib/queries";
import { renderWithClient } from "./utils";

const fixture = providers.find((p) => p.id === "claude") as ProviderInfo;
const ALL = ["low", "medium", "high", "xhigh", "max"] as ModelInfo["efforts"];

/** Claude Code's list as its CLI reports it: aliases first, with the full id each one runs. */
const claude: ProviderInfo = {
  ...fixture,
  models: [
    {
      id: "default",
      resolvedId: "claude-opus-5-5",
      label: "Default (recommended)",
      description: "Opus 5.5 · Best for everyday, complex tasks",
      efforts: ALL,
      isDefault: true,
    },
    { id: "opus", resolvedId: "claude-opus-5-5", label: "Opus 5.5", efforts: ALL },
    { id: "fable", resolvedId: "claude-fable-5-2", label: "Fable 5.2", efforts: ALL },
    { id: "sonnet", resolvedId: "claude-sonnet-5-5", label: "Sonnet 5.5", efforts: ALL },
    { id: "haiku", resolvedId: "claude-haiku-5-5", label: "Haiku 5.5", efforts: [] },
    { id: "claude-fable-5-1", label: "Fable 5.1", efforts: ["low", "high"] },
  ],
};

/** The same list from a runner that doesn't report resolved ids. */
const unresolved: ProviderInfo = {
  ...claude,
  models: claude.models.map(({ resolvedId: _drop, ...m }) => m),
};

describe("full model ids and aliases", () => {
  it("matches a full id to the alias that runs it, never to the default entry", () => {
    const resolved = resolveModel(claude, "claude-opus-5-5");
    expect(resolved).toEqual({
      model: claude.models[1],
      followsDefault: false,
      missing: null,
    });
    expect(triggerText(claude, resolved)).toBe("Opus 5.5");
    expect(aliasFor(claude, "claude-fable-5-2")?.id).toBe("fable");
    // A model listed under its own id stays exact.
    expect(resolveModel(claude, "claude-fable-5-1").model?.id).toBe("claude-fable-5-1");
  });

  it("falls back to a versioned name when the provider reports no resolved ids", () => {
    expect(aliasFor(unresolved, "claude-opus-5-5")?.id).toBe("opus");
    expect(aliasFor(unresolved, "claude-sonnet-5-5")?.id).toBe("sonnet");
    // From the description when only it carries the version.
    const described: ProviderInfo = {
      ...unresolved,
      models: [{ ...unresolved.models[0], id: "default" } as ModelInfo],
    };
    expect(aliasFor(described, "claude-opus-5-5")?.id).toBe("default");
    // Unversioned names never match: "Opus" could be any Opus.
    expect(aliasFor(fixture, "claude-opus-4-1")).toBeUndefined();
    expect(aliasFor(unresolved, "claude-opus-5")).toBeUndefined();
  });

  it("gives an unmatched id the provider default's effort levels", () => {
    const resolved = resolveModel(claude, "claude-opus-3");
    expect(resolved.missing).toBe("claude-opus-3");
    expect(resolvedEfforts(claude, resolved).levels).toEqual(ALL);
    expect(resolvedEfforts(claude, resolveModel(claude, "haiku")).levels).toEqual([]);
  });

  it("shows a full id's alias as selected, with its effort levels", async () => {
    renderWithClient(
      <ModelPicker
        providers={[claude]}
        value={{ provider: "claude", model: "claude-opus-5-5", effort: "high" }}
        onChange={() => {}}
      />,
      createMockClient(),
      { withRouter: true },
    );
    const trigger = await screen.findByRole("button", { name: /^Provider and model/ });
    expect(trigger.getAttribute("aria-label")).toBe(
      "Provider and model: Claude Code Opus 5.5, High effort",
    );
    fireEvent.click(trigger);
    const picker = await screen.findByTestId("model-picker");
    expect(within(picker).queryByText(/isn't in the provider's list/)).toBeNull();
    const levels = within(within(picker).getByRole("radiogroup")).getAllByRole("radio");
    expect(levels.map((r) => r.textContent)).toEqual([
      "Low",
      "Medium",
      "High",
      "Extra high",
      "Max",
    ]);
    expect(within(picker).getByRole("radio", { name: /High/, checked: true })).toBeTruthy();
    const checked = within(picker)
      .getAllByRole("option")
      .filter((o) => o.getAttribute("data-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toContain("Opus 5.5");
  });
});

describe("Refresh models", () => {
  it("asks the shown provider again and shows the new list", async () => {
    const client = createMockClient();
    const released: ProviderInfo = {
      ...fixture,
      models: [
        ...fixture.models,
        { id: "fable", resolvedId: "claude-fable-5-2", label: "Fable 5.2", efforts: ALL },
      ],
    };
    const asked: string[] = [];
    client.refreshModels = async (providerId) => {
      asked.push(providerId);
      return { providers: providers.map((p) => (p.id === "claude" ? released : p)) };
    };
    const { queryClient } = renderWithClient(<SnapshotPicker />, client, { withRouter: true });
    await waitFor(() => expect(queryClient.getQueryData(snapshotKey)).toBeTruthy());
    fireEvent.click(await screen.findByRole("button", { name: /^Provider and model/ }));
    const picker = await screen.findByTestId("model-picker");
    expect(within(picker).queryByRole("option", { name: /^Fable 5\.2/ })).toBeNull();

    fireEvent.click(within(picker).getByRole("button", { name: "Refresh Claude Code's models" }));
    expect(await within(picker).findByRole("option", { name: /^Fable 5\.2/ })).toBeTruthy();
    expect(asked).toEqual(["claude"]);
  });
});

/** A picker fed from the snapshot, like the composer's. */
function SnapshotPicker() {
  const list = useSnapshotData((s) => s.runner.providers, []);
  return (
    <ModelPicker
      providers={list}
      value={{ provider: "claude", model: "opus", effort: null }}
      onChange={() => {}}
      lockedProvider="claude"
    />
  );
}
