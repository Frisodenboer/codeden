import type { CustomModel, ProviderInfo } from "@codeden/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  addCustomModel,
  CUSTOM_DESCRIPTION,
  customEfforts,
  isCustom,
  removeCustomModel,
  withCustomModels,
} from "@/components/composer/model-picker/custom";
import { chooseModel, type ModelChoice } from "@/components/composer/model-picker/logic";
import { ModelPicker } from "@/components/composer/model-picker/model-picker";
import { CustomModelSettings } from "@/components/settings/custom-models";
import { createMockClient } from "@/lib/api/mock";
import { providers } from "@/lib/api/mock/fixtures/world";
import { snapshotKey } from "@/lib/queries";
import { renderWithClient } from "./utils";

const claude = providers.find((p) => p.id === "claude") as ProviderInfo;
const codex = providers.find((p) => p.id === "codex") as ProviderInfo;
/** A provider without effort levels, like the Fake provider. */
const plain: ProviderInfo = {
  ...claude,
  id: "fake",
  displayName: "Fake",
  capabilities: { ...claude.capabilities, reasoningEffort: false },
};

describe("custom model rules", () => {
  it("appends custom models after the listed ones; a listed id wins", () => {
    const custom = { claude: [{ id: "opus-6-preview", label: "Opus 6 preview" }, { id: "opus" }] };
    const [merged, untouched] = withCustomModels([claude, codex], custom);
    expect(merged?.models.map((m) => m.id)).toEqual(["opus", "sonnet", "haiku", "opus-6-preview"]);
    expect(merged?.models.at(-1)).toMatchObject({
      id: "opus-6-preview",
      label: "Opus 6 preview",
      description: CUSTOM_DESCRIPTION,
    });
    expect(merged?.models[0]).toEqual(claude.models[0]);
    expect(untouched).toBe(codex);
    expect(withCustomModels([claude], { claude: [{ id: "x-1" }] })[0]?.models.at(-1)?.label).toBe(
      "x-1",
    );
  });

  it("gives a custom model the default model's efforts, or none without effort support", () => {
    // Claude's default model (Opus) offers low to max, high by default.
    expect(customEfforts(claude)).toEqual({
      efforts: ["low", "medium", "high", "xhigh", "max"],
      defaultEffort: "high",
    });
    const defaultCodex = codex.models.find((m) => m.isDefault);
    expect(customEfforts(codex).efforts).toEqual(defaultCodex?.efforts);
    expect(customEfforts(plain)).toEqual({ efforts: [] });
    const [withCustom] = withCustomModels([plain], { fake: [{ id: "fake-next" }] });
    const model = withCustom?.models.at(-1);
    if (!withCustom || !model) throw new Error("no custom model");
    expect(model.efforts).toEqual([]);
    expect(
      chooseModel({ provider: "fake", model: null, effort: "high" }, withCustom, model),
    ).toEqual({ provider: "fake", model: "fake-next", effort: null });
  });

  it("validates new ids: non-empty, not a duplicate, not already listed", () => {
    const list: CustomModel[] = [{ id: "a" }];
    expect(addCustomModel(list, claude, { id: "  " })).toEqual({ error: "Enter a model id" });
    expect(addCustomModel(list, claude, { id: " a " })).toEqual({
      error: "a is already a custom model",
    });
    expect(addCustomModel(list, claude, { id: "sonnet" })).toEqual({
      error: "Claude Code already lists sonnet",
    });
    expect(addCustomModel(list, claude, { id: " b ", label: "  " })).toEqual({
      list: [{ id: "a" }, { id: "b" }],
    });
    expect(addCustomModel([], claude, { id: "c", label: " C " })).toEqual({
      list: [{ id: "c", label: "C" }],
    });
    expect(removeCustomModel([{ id: "a" }, { id: "b" }], "a")).toEqual([{ id: "b" }]);
  });

  it("marks only ids the provider doesn't list as custom", () => {
    const custom = { claude: [{ id: "x-1" }, { id: "opus" }] };
    expect(isCustom(custom, claude, "claude", "x-1")).toBe(true);
    expect(isCustom(custom, claude, "claude", "opus")).toBe(false);
    expect(isCustom(custom, codex, "codex", "x-1")).toBe(false);
  });
});

function Harness({ initial }: { initial: ModelChoice }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <ModelPicker providers={providers} value={value} onChange={setValue} />
      <output data-testid="choice">{JSON.stringify(value)}</output>
    </>
  );
}

describe("custom models in the picker", () => {
  it("lists them marked Custom and passes the id through unchanged", async () => {
    const client = createMockClient();
    await client.updateSettings({
      models: { custom: { claude: [{ id: "claude-opus-6-preview", label: "Opus 6 preview" }] } },
    });
    const { queryClient } = renderWithClient(
      <Harness initial={{ provider: "claude", model: "opus", effort: "medium" }} />,
      client,
      { withRouter: true },
    );
    const trigger = await screen.findByRole("button", { name: /^Provider and model/ });
    await waitFor(() => expect(queryClient.getQueryData(snapshotKey)).toBeTruthy());
    fireEvent.click(trigger);
    const picker = await screen.findByTestId("model-picker");
    const row = await within(picker).findByRole("option", { name: /^Opus 6 preview\s*,/ });
    expect(within(row).getByText("Custom")).toBeTruthy();
    expect(within(picker).getByRole("option", { name: /^Opus\s*,/ }).textContent).not.toContain(
      "Custom",
    );
    fireEvent.click(row);
    await waitFor(() =>
      expect(JSON.parse(screen.getByTestId("choice").textContent ?? "{}")).toEqual({
        provider: "claude",
        model: "claude-opus-6-preview",
        effort: "medium",
      }),
    );
  });
});

describe("CustomModelSettings", () => {
  it("adds and removes custom ids per provider, refusing empty and duplicate ids", async () => {
    const client = createMockClient();
    const save = vi.spyOn(client, "updateSettings");
    const { queryClient } = renderWithClient(<CustomModelSettings />, client);
    await waitFor(() => expect(queryClient.getQueryData(snapshotKey)).toBeTruthy());
    const id = await screen.findByRole("textbox", { name: "Codex custom model id" });
    const label = screen.getByRole("textbox", { name: "Codex custom model label" });
    const section = screen.getByTestId("custom-models-codex");
    const add = within(section).getByRole("button", { name: "Add" });

    fireEvent.click(add);
    expect(within(section).getByRole("alert").textContent).toBe("Enter a model id");
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(id, { target: { value: "gpt-7-preview" } });
    fireEvent.change(label, { target: { value: "GPT-7 preview" } });
    fireEvent.click(add);
    expect(save).toHaveBeenLastCalledWith({
      models: { custom: { codex: [{ id: "gpt-7-preview", label: "GPT-7 preview" }] } },
    });
    expect(await within(section).findByText("GPT-7 preview")).toBeTruthy();
    expect((id as HTMLInputElement).value).toBe("");

    fireEvent.change(id, { target: { value: "gpt-7-preview" } });
    fireEvent.click(add);
    expect(within(section).getByRole("alert").textContent).toBe(
      "gpt-7-preview is already a custom model",
    );
    expect(save).toHaveBeenCalledTimes(1);

    fireEvent.click(within(section).getByRole("button", { name: "Remove GPT-7 preview" }));
    expect(save).toHaveBeenLastCalledWith({ models: { custom: { codex: [] } } });
    await waitFor(() => expect(within(section).queryByText("GPT-7 preview")).toBeNull());
    const settings = await client.getSnapshot();
    expect(settings.settings.models.custom).toEqual({ codex: [] });
  });
});
