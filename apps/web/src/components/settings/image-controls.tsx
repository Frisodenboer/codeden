import type { ImageEngineSetting, ImageTestResponse } from "@codeden/contracts";
import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClient } from "@/lib/api";

const ENGINE_OPTIONS: { value: ImageEngineSetting; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "codex", label: "Codex (your login)" },
  { value: "gemini", label: "Gemini image models" },
  { value: "openai", label: "OpenAI Images" },
  { value: "none", label: "None (hide the tool)" },
];

export function EngineSelect({
  value,
  onChange,
  inherit,
  label,
}: {
  value: ImageEngineSetting | "inherit";
  onChange: (v: ImageEngineSetting | "inherit") => void;
  inherit?: boolean;
  label: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ImageEngineSetting | "inherit")}>
      <SelectTrigger size="sm" className="w-48" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {inherit && <SelectItem value="inherit">Same as global</SelectItem>}
        {ENGINE_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function TestResult({
  result,
  pending,
  onTest,
}: {
  result: ImageTestResponse | null;
  pending: boolean;
  onTest: () => void;
}) {
  const client = useClient();
  return (
    <div className="space-y-3" data-testid="image-test">
      <Button size="sm" variant="outline" onClick={onTest} disabled={pending}>
        <FlaskConical /> {pending ? "Generating…" : "Test"}
      </Button>
      {result && !result.ok && (
        <p className="text-2xs text-status-failed">{result.error?.message ?? "The test failed."}</p>
      )}
      {result?.ok && (
        <div className="flex items-start gap-3">
          {result.artifact && (
            <img
              src={client.artifactUrl(result.artifact.id)}
              alt="Generated test"
              className="size-40 rounded-lg border border-border object-cover"
            />
          )}
          <div className="text-2xs text-muted-foreground">
            <div className="font-medium text-foreground">Generated with {result.engine}</div>
            {result.model && <div className="font-mono">{result.model}</div>}
            <div>{(result.durationMs / 1000).toFixed(1)}s</div>
          </div>
        </div>
      )}
    </div>
  );
}
