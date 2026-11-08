import type { ProviderInfo } from "@codeden/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { isHidden, toggleHidden, visibleRows } from "@/components/composer/model-picker/hidden";
import {
  favoriteRows,
  type ModelChoice,
  providerTabs,
  rowKey,
  tabRows,
} from "@/components/composer/model-picker/logic";
import { ModelPicker } from "@/components/composer/model-picker/model-picker";
import { ModelVisibilitySettings } from "@/components/settings/model-visibility";
import { createMockClient } from "@/lib/api/mock";
import { providers } from "@/lib/api/mock/fixtures/world";
import { snapshotKey } from "@/lib/queries";
import { renderWithClient } from "./utils";

const claude = providers.find((p) => p.id === "claude") as ProviderInfo;
const codex = providers.find((p) => p.id === "codex") as ProviderInfo;

describe("hidden model rules", () => {
  const claudeRows = tabRows(providerTabs([claude], undefined, undefined)[0], [claude], []);

  it("leaves hidden models out, keeps the selected one and can reveal the rest", () => {
    const hidden = { claude: ["sonnet", "haiku"] };
    const none = visibleRows(claudeRows, hidden, null, false);
    expect(none.rows.map((r) => r.model.id)).toEqual(["opus"]);
    expect(none.hiddenCount).toBe(2);
    // A selection is never lost: the selected hidden model stays.
    const selected = visibleRows(claudeRows, hidden, rowKey("claude", "haiku"), false);
    expect(selected.rows.map((r) => r.model.id)).toEqual(["opus", "haiku"]);
    expect(selected.hiddenCount).toBe(1);
    expect(visibleRows(claudeRows, hidden, null, true).rows).toHaveLength(3);
  });

  it("hides and shows one model, leaving the rest of the provider's list", () => {
    expect(toggleHidden({}, "codex", "a")).toEqual(["a"]);
    expect(toggleHidden({ codex: ["a", "b"] }, "codex", "a")).toEqual(["b"]);
    expect(isHidden({ codex: ["a"] }, "codex", "a")).toBe(true);
    expect(isHidden({ codex: ["a"] }, "claude", "a")).toBe(false);
  });

  it("drops a hidden favourite out of the Favourites list", () => {
    const favorites = [
      { provider: "claude", model: "sonnet" },
      { provider: "codex", model: "gpt-6-astra" },
    ];
    const rows = visibleRows(
      favoriteRows(favorites, [claude, codex]),
      { codex: ["gpt-6-astra"] },
      null,
      false,
    );
    expect(rows.rows.map((r) => r.model.id)).toEqual(["sonnet"]);
  });
});

function Harness({ initial, lockedProvider }: { initial: ModelChoice; lockedProvider?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <ModelPicker
      providers={providers}
      value={value}
      onChange={setValue}
      lockedProvider={lockedProvider}
    />
  );
}

async function openWith(
  initial: ModelChoice,
  models: { hidden?: Record<string, string[]>; favorites?: { provider: string; model: string }[] },
  lockedProvider?: string,
) {
  const client = createMockClient();
  await client.updateSettings({ models });
  const save = vi.spyOn(client, "updateSettings");
  const { queryClient } = renderWithClient(
    <Harness initial={initial} lockedProvider={lockedProvider} />,
    client,
    { withRouter: true },
  );
  const trigger = await screen.findByRole("button", { name: /^Provider and model/ });
  await waitFor(() => expect(queryClient.getQueryData(snapshotKey)).toBeTruthy());
  fireEvent.click(trigger);
  const picker = await screen.findByTestId("model-picker");
  return { picker, save, trigger };
}

const names = (picker: HTMLElement) =>
  within(picker)
    .queryAllByRole("option")
    .map((o) => o.textContent ?? "");

describe("hiding models in the picker", () => {
  it("hides a model from its row, reveals it on demand and shows it again", async () => {
    const { picker, save } = await openWith(
      { provider: "claude", model: "opus", effort: null },
      {},
    );
    fireEvent.click(within(picker).getByRole("button", { name: "Hide Sonnet from the picker" }));
    expect(save).toHaveBeenLastCalledWith({ models: { hidden: { claude: ["sonnet"] } } });
    await waitFor(() => expect(names(picker).some((n) => n.includes("Sonnet"))).toBe(false));

    fireEvent.click(within(picker).getByRole("option", { name: /Show 1 hidden model/ }));
    const sonnet = await within(picker).findByRole("option", { name: /^Sonnet\s*,/ });
    expect(sonnet.getAttribute("data-hidden")).toBe("true");
    expect(within(sonnet).getByText("Hidden")).toBeTruthy();

    fireEvent.click(within(picker).getByRole("button", { name: "Show Sonnet in the picker" }));
    expect(save).toHaveBeenLastCalledWith({ models: { hidden: { claude: [] } } });
  });

  it("keeps a hidden model that is still selected visible and selectable, marked hidden", async () => {
    const { picker, trigger } = await openWith(
      { provider: "codex", model: "gpt-6-nova", effort: null },
      { hidden: { codex: ["gpt-6-nova", "gpt-5.5-terra"] } },
      "codex",
    );
    expect(trigger.getAttribute("aria-label")).toContain("gpt-6-nova");
    const nova = within(picker).getByRole("option", { name: /^gpt-6-nova\s*,/ });
    expect(nova.getAttribute("data-hidden")).toBe("true");
    expect(nova.getAttribute("data-checked")).toBe("true");
    expect(names(picker).some((n) => n.includes("gpt-5.5-terra"))).toBe(false);
    // Search follows the same rule.
    fireEvent.change(within(picker).getByRole("combobox"), { target: { value: "terra" } });
    expect(await within(picker).findByText(/No models match/)).toBeTruthy();
    fireEvent.change(within(picker).getByRole("combobox"), { target: { value: "nova" } });
    expect(await within(picker).findByRole("option", { name: /^gpt-6-nova\s*,/ })).toBeTruthy();
  });

  it("leaves a hidden favourite out of Favourites", async () => {
    const { picker } = await openWith(
      { provider: "claude", model: "opus", effort: null },
      {
        favorites: [
          { provider: "claude", model: "sonnet" },
          { provider: "codex", model: "gpt-6-astra" },
        ],
        hidden: { codex: ["gpt-6-astra"] },
      },
    );
    const list = names(picker);
    expect(list).toHaveLength(1);
    expect(list[0]).toContain("Sonnet");
  });
});

describe("ModelVisibilitySettings", () => {
  it("hides and shows models per provider", async () => {
    const client = createMockClient();
    const save = vi.spyOn(client, "updateSettings");
    const { queryClient } = renderWithClient(<ModelVisibilitySettings />, client);
    await waitFor(() => expect(queryClient.getQueryData(snapshotKey)).toBeTruthy());
    const chip = await screen.findByRole("button", { name: "Show gpt-5.5-terra in the picker" });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(save).toHaveBeenLastCalledWith({ models: { hidden: { codex: ["gpt-5.5-terra"] } } });
    await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("false"));
    expect(screen.getByText("7 of 8 shown")).toBeTruthy();
  });
});
