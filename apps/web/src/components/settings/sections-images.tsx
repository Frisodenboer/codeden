import type { ImageGenerationOverride, ImageTestResponse, SettingsPatch } from "@codeden/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StatusDot } from "@/components/common/status-dot";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClient } from "@/lib/api";
import { useSnapshotData } from "@/lib/queries";
import { EngineSelect, TestResult } from "./image-controls";
import { SecretField } from "./secret-field";
import { Segmented, SettingRow, SettingsSection, useSettings } from "./settings-ui";

/** Image generation settings (§12.5): engines, the active one, caps, overrides, keys, test. */
export function ImageSettings() {
  const client = useClient();
  const queryClient = useQueryClient();
  const { settings, update } = useSettings();
  const ig = settings.imageGeneration;
  const projects = useSnapshotData((s) => s.projects, []);
  const [projectId, setProjectId] = useState<string>("");
  const engines = useQuery({
    queryKey: ["image-engines", projectId, ig],
    queryFn: () => client.images.engines(projectId || null),
  });
  const recheck = () => void queryClient.invalidateQueries({ queryKey: ["image-engines"] });
  const [result, setResult] = useState<ImageTestResponse | null>(null);
  const test = useMutation({
    mutationFn: () => client.images.test({ projectId: projectId || undefined }),
    onMutate: () => setResult(null),
    onSuccess: (r) => {
      setResult(r);
      recheck();
    },
    onError: (e) =>
      setResult({
        ok: false,
        engine: null,
        durationMs: 0,
        error: { code: "error", message: e.message },
      }),
  });
  const override: ImageGenerationOverride | undefined = projectId
    ? ig.projects[projectId]
    : undefined;
  // Settings PATCHes deep-merge, so clearing one field replaces the whole override.
  const setOverride = async (patch: ImageGenerationOverride | null) => {
    const patchOf = (value: ImageGenerationOverride | null) =>
      ({ imageGeneration: { projects: { [projectId]: value } } }) as SettingsPatch;
    const next = patch === null ? {} : { ...override, ...patch };
    for (const k of Object.keys(next) as (keyof ImageGenerationOverride)[]) {
      if (next[k] === undefined) delete next[k];
    }
    const clearing = patch !== null && Object.values(patch).some((v) => v === undefined);
    if (patch === null || clearing || Object.keys(next).length === 0) {
      await client.updateSettings(patchOf(null));
    }
    if (Object.keys(next).length > 0) await client.updateSettings(patchOf(next));
  };
  const active = engines.data?.active;

  return (
    <>
      <SettingsSection
        title="Image generation"
        description="Every agent gets one generate_image tool, routed to the engine you pick here."
      >
        <div className="grid gap-2 p-4 sm:grid-cols-3" data-testid="image-engines">
          {(engines.data?.engines ?? []).map((e) => (
            <div key={e.id} className="rounded-lg border border-border bg-background/40 p-3">
              <div className="flex items-center gap-2 text-[13px] font-medium">
                <StatusDot tone={e.available ? "done" : "idle"} /> {e.label}
                {active?.engine === e.id && (
                  <span className="ml-auto rounded-full bg-primary/12 px-1.5 text-3xs text-primary">
                    active
                  </span>
                )}
              </div>
              <div className="mt-1 text-2xs text-muted-foreground">
                {e.reason ?? (e.available ? "Ready" : "Unavailable")}
              </div>
              <div className="mt-1 font-mono text-3xs text-muted-foreground/80">
                {e.defaultModel}
              </div>
            </div>
          ))}
          {engines.isLoading && (
            <div className="text-xs text-muted-foreground">Checking engines…</div>
          )}
        </div>
        <SettingRow
          label="Engine"
          help={
            active
              ? active.engine
                ? `Agents use ${engines.data?.engines.find((e) => e.id === active.engine)?.label ?? active.engine}.`
                : (active.reason ?? "No engine is available, so the tool is hidden from agents.")
              : "Auto uses Codex when it's signed in. None hides the tool from agents."
          }
        >
          <EngineSelect
            label="Global image engine"
            value={ig.engine}
            onChange={(engine) => engine !== "inherit" && update({ imageGeneration: { engine } })}
          />
        </SettingRow>
        <SettingRow label="Default size">
          <Segmented
            value={ig.defaultSize}
            onChange={(defaultSize) => update({ imageGeneration: { defaultSize } })}
            options={[
              { value: "1024x1024", label: "Square" },
              { value: "1536x1024", label: "Landscape" },
              { value: "1024x1536", label: "Portrait" },
            ]}
          />
        </SettingRow>
        <SettingRow label="Quality">
          <Segmented
            value={ig.quality}
            onChange={(quality) => update({ imageGeneration: { quality } })}
            options={[
              { value: "auto", label: "Auto" },
              { value: "low", label: "Low" },
              { value: "medium", label: "Medium" },
              { value: "high", label: "High" },
            ]}
          />
        </SettingRow>
        <SettingRow
          label="Daily cap"
          help={
            engines.data
              ? `${engines.data.usage.total} generated today · 0 turns generation off.`
              : "Maximum images per day across all agents. 0 turns generation off."
          }
        >
          <Input
            type="number"
            min={0}
            aria-label="Daily image cap"
            value={ig.dailyCap}
            onChange={(e) =>
              update({ imageGeneration: { dailyCap: Math.max(0, Number(e.target.value) || 0) } })
            }
            className="h-8 w-24 text-xs"
          />
        </SettingRow>
        <SettingRow
          label="Gemini API key"
          help="For Gemini image models. Stored in the OS keychain."
        >
          <SecretField secret="gemini.apiKey" label="Gemini key" onChange={recheck} />
        </SettingRow>
        <SettingRow
          label="OpenAI API key"
          help="For OpenAI Images (also used for OpenAI dictation)."
        >
          <SecretField secret="openai.apiKey" label="OpenAI key" onChange={recheck} />
        </SettingRow>
        <SettingRow
          label="Test the active engine"
          help="Generates one small image. It counts toward today's cap."
          stacked
        >
          <TestResult result={result} pending={test.isPending} onTest={() => test.mutate()} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Per-project override"
        description="A project can use its own engine and cap; unset fields follow the global settings."
      >
        <SettingRow label="Project">
          <Select
            value={projectId || "none"}
            onValueChange={(v) => setProjectId(v === "none" ? "" : v)}
          >
            <SelectTrigger size="sm" className="w-48" aria-label="Override project">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Choose a project</SelectItem>
              {projects.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingRow>
        {projectId && (
          <>
            <SettingRow label="Engine for this project">
              <EngineSelect
                label="Project image engine"
                inherit
                value={override?.engine ?? "inherit"}
                onChange={(v) => void setOverride({ engine: v === "inherit" ? undefined : v })}
              />
            </SettingRow>
            <SettingRow
              label="Project daily cap"
              help={
                engines.data
                  ? `Effective cap: ${engines.data.dailyCap} · ${engines.data.usage.byProject[projectId] ?? 0} today`
                  : undefined
              }
            >
              <Input
                type="number"
                min={0}
                aria-label="Project daily cap"
                placeholder="global"
                value={override?.dailyCap ?? ""}
                onChange={(e) =>
                  void setOverride({
                    dailyCap:
                      e.target.value === "" ? undefined : Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="h-8 w-24 text-xs"
              />
            </SettingRow>
            <SettingRow label="Remove the override">
              <Button
                size="sm"
                variant="outline"
                disabled={!override}
                onClick={() => void setOverride(null)}
              >
                Use global settings
              </Button>
            </SettingRow>
          </>
        )}
      </SettingsSection>
    </>
  );
}
