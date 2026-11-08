import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ModelChoice } from "@/components/composer/model-picker/logic";
import {
  ModelPicker,
  type ModelPickerProps,
} from "@/components/composer/model-picker/model-picker";
import { providers } from "@/lib/api/mock/fixtures/world";
import { renderWithClient } from "./utils";

function Harness({
  initial,
  onPick,
  ...rest
}: Partial<ModelPickerProps> & {
  initial: ModelChoice | null;
  onPick?: (v: ModelChoice) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <ModelPicker
      providers={providers}
      value={value}
      onChange={(v) => {
        onPick?.(v);
        setValue(v);
      }}
      {...rest}
    />
  );
}

async function setup(props: Parameters<typeof Harness>[0]) {
  const onPick = vi.fn();
  renderWithClient(<Harness onPick={onPick} {...props} />, undefined, { withRouter: true });
  const trigger = await screen.findByRole("button", { name: /^Provider and model/ });
  return { onPick, trigger };
}

async function openPicker(trigger: HTMLElement) {
  fireEvent.click(trigger);
  return screen.findByTestId("model-picker");
}

const optionName = (name: string) =>
  new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*,`);
const option = (name: string) => screen.getByRole("option", { name: optionName(name) });

describe("ModelPicker", () => {
  it("names the provider, model and effort on one trigger", async () => {
    const { trigger } = await setup({
      initial: { provider: "claude", model: "opus", effort: null },
    });
    expect(trigger.getAttribute("aria-label")).toBe(
      "Provider and model: Claude Code Opus, High effort",
    );
    expect(trigger.textContent).toContain("Opus");
    expect(trigger.textContent).toContain("High");
  });

  it("picks a model, clamps the effort and moves focus to that model's levels", async () => {
    const { trigger, onPick } = await setup({
      initial: { provider: "claude", model: "opus", effort: "max" },
    });
    const picker = await openPicker(trigger);
    expect(document.activeElement).toBe(within(picker).getByRole("combobox"));
    fireEvent.click(option("Sonnet"));
    // Sonnet has no Max, so its default (Medium) is used.
    expect(onPick).toHaveBeenLastCalledWith({
      provider: "claude",
      model: "sonnet",
      effort: "medium",
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Medium" })),
    );
    expect(
      within(screen.getByRole("radiogroup"))
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["Low", "Medium", "High"]);
    fireEvent.click(screen.getByRole("radio", { name: /High/ }));
    expect(onPick).toHaveBeenLastCalledWith({
      provider: "claude",
      model: "sonnet",
      effort: "high",
    });
    await waitFor(() => expect(screen.queryByTestId("model-picker")).toBeNull());
    expect(trigger.getAttribute("aria-label")).toContain("Sonnet, High effort");
  });

  it("closes at once for a model without effort levels and drops the effort", async () => {
    const { trigger, onPick } = await setup({
      initial: { provider: "claude", model: "opus", effort: "high" },
    });
    await openPicker(trigger);
    fireEvent.click(option("Haiku"));
    expect(onPick).toHaveBeenLastCalledWith({ provider: "claude", model: "haiku", effort: null });
    await waitFor(() => expect(screen.queryByTestId("model-picker")).toBeNull());
    expect(trigger.getAttribute("aria-label")).not.toContain("effort");
  });

  it("works from the keyboard: arrows and Enter pick, Left goes back to search", async () => {
    const { trigger, onPick } = await setup({
      initial: { provider: "claude", model: "opus", effort: "xhigh" },
    });
    const picker = await openPicker(trigger);
    const search = within(picker).getByRole("combobox");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    // Sonnet has no Extra high, so its default (Medium) is used.
    expect(onPick).toHaveBeenLastCalledWith({
      provider: "claude",
      model: "sonnet",
      effort: "medium",
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("radio", { name: "Medium" })),
    );
    fireEvent.keyDown(document.activeElement as Element, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(search);
  });

  it("shows other providers locked when the provider is fixed", async () => {
    const { trigger, onPick } = await setup({
      initial: { provider: "codex", model: "gpt-6-nova", effort: null },
      lockedProvider: "codex",
    });
    const picker = await openPicker(trigger);
    const claude = within(picker).getByRole("button", { name: /Claude Code can't be used/ });
    expect(claude.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(claude);
    expect(within(picker).queryByRole("option", { name: optionName("Opus") })).toBeNull();
    expect(option("gpt-6-nova")).toBeTruthy();
    fireEvent.change(within(picker).getByRole("combobox"), { target: { value: "opus" } });
    expect(await within(picker).findByText(/No models match/)).toBeTruthy();
    expect(onPick).not.toHaveBeenCalled();
  });

  it("marks providers that aren't signed in and explains how to fix them", async () => {
    const { trigger } = await setup({
      initial: { provider: "claude", model: "opus", effort: null },
    });
    const picker = await openPicker(trigger);
    const codex = await within(picker).findByRole("button", { name: /^Codex: Not signed in/ });
    fireEvent.click(codex);
    expect(within(picker).getByText(/codex login/)).toBeTruthy();
    expect(within(picker).getByRole("button", { name: /Open setup/ })).toBeTruthy();
    // Models stay pickable: detection can lag behind a fresh login.
    expect(option("gpt-6.1-sol")).toBeTruthy();
  });

  it("searches every provider and hides the rail while searching", async () => {
    const { trigger } = await setup({
      initial: { provider: "claude", model: "opus", effort: null },
    });
    const picker = await openPicker(trigger);
    expect(within(picker).getByRole("toolbar", { name: "Providers" })).toBeTruthy();
    fireEvent.change(within(picker).getByRole("combobox"), { target: { value: "mini" } });
    await waitFor(() =>
      expect(within(picker).queryByRole("toolbar", { name: "Providers" })).toBeNull(),
    );
    const names = within(picker)
      .getAllByRole("option")
      .map((o) => o.textContent);
    expect(names.every((n) => n?.includes("-mini"))).toBe(true);
    expect(names.length).toBe(3);
  });

  it("switches provider with Ctrl+Shift+Down", async () => {
    const { trigger } = await setup({
      initial: { provider: "claude", model: "opus", effort: null },
    });
    const picker = await openPicker(trigger);
    expect(option("Opus")).toBeTruthy();
    act(() => {
      fireEvent.keyDown(within(picker).getByRole("combobox"), {
        key: "ArrowDown",
        ctrlKey: true,
        shiftKey: true,
      });
    });
    expect(
      await within(picker).findByRole("option", { name: optionName("gpt-6.1-sol") }),
    ).toBeTruthy();
  });

  it('shows "default" and null as the provider\'s default model, checked in the list', async () => {
    for (const model of ["default", null]) {
      const { trigger, onPick } = await setup({
        initial: { provider: "codex", model, effort: null },
      });
      expect(trigger.getAttribute("aria-label")).toBe(
        "Provider and model: Codex Default (gpt-6.1-sol), Medium effort",
      );
      expect(trigger.textContent).toContain("Default (gpt-6.1-sol)");
      await openPicker(trigger);
      expect(option("gpt-6.1-sol").getAttribute("data-checked")).toBe("true");
      // Picking the checked row keeps following the default rather than pinning it.
      fireEvent.click(option("gpt-6.1-sol"));
      expect(onPick).toHaveBeenLastCalledWith({ provider: "codex", model, effort: null });
      cleanup();
    }
  });

  it('names the provider when it only lists its fallback "Default"', async () => {
    const fallback = providers.map((p) =>
      p.id === "codex"
        ? { ...p, models: [{ id: "default", label: "Default", efforts: [], isDefault: true }] }
        : p,
    );
    const { trigger } = await setup({
      initial: { provider: "codex", model: null, effort: null },
      providers: fallback,
    });
    expect(trigger.textContent).toContain("Codex · Default");
    await openPicker(trigger);
    expect(option("Default").getAttribute("data-checked")).toBe("true");
  });

  it("shows a placeholder and footer choices, and can hide effort", async () => {
    const onAuto = vi.fn();
    const { trigger } = await setup({
      initial: null,
      placeholder: "Auto",
      effort: false,
      footer: (close) => (
        <button
          type="button"
          onClick={() => {
            onAuto();
            close();
          }}
        >
          Use Auto
        </button>
      ),
    });
    expect(trigger.getAttribute("aria-label")).toBe("Provider and model: Auto");
    const picker = await openPicker(trigger);
    expect(within(picker).queryByRole("radiogroup")).toBeNull();
    fireEvent.click(within(picker).getByRole("button", { name: "Use Auto" }));
    expect(onAuto).toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("model-picker")).toBeNull());
  });
});
