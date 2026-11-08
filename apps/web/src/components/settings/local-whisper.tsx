import type { LocalSttModel, LocalSttStatus, WhisperModelId } from "@codeden/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Loader2, RotateCw, Trash2 } from "lucide-react";
import { useCallback } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useClient } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

export const LOCAL_STT_KEY = ["voice", "local"] as const;

/**
 * Local Whisper status (§11.3). Polls while a download runs, so progress stays live in
 * Settings and in first-run setup, and keeps going if the user moves on.
 */
export function useLocalStt(enabled = true) {
  const client = useClient();
  return useQuery({
    queryKey: LOCAL_STT_KEY,
    queryFn: () => client.voice.localStatus(),
    enabled,
    retry: false,
    refetchInterval: (query) => {
      const s = query.state.data;
      const busy =
        s?.runtime.state === "downloading" || s?.models.some((m) => m.state === "downloading");
      return busy ? 700 : false;
    },
  });
}

/** Download and delete, with the returned status written straight into the query. */
export function useLocalSttActions() {
  const client = useClient();
  const queryClient = useQueryClient();
  const run = useCallback(
    async (label: string, fn: () => Promise<LocalSttStatus>) => {
      try {
        queryClient.setQueryData(LOCAL_STT_KEY, await fn());
      } catch (error) {
        toast.error(label, { description: (error as Error).message });
      }
    },
    [queryClient],
  );
  return {
    download: (id: WhisperModelId) =>
      run("Couldn't start the download", () => client.voice.downloadLocalModel(id)),
    remove: (id: WhisperModelId) =>
      run("Couldn't delete the model", () => client.voice.deleteLocalModel(id)),
  };
}

const percent = (received: number, total: number) =>
  total > 0 ? Math.min(100, Math.floor((received / total) * 100)) : 0;

/** One line describing where a model stands, e.g. `Downloading 42% of 57.0 MB`. */
export function modelStatusText(status: LocalSttStatus, model: LocalSttModel): string {
  if (!status.supported) return status.unsupportedReason ?? "Not available on this machine";
  if (model.state === "downloading") {
    if (status.runtime.state === "downloading") {
      return `Downloading the Whisper runtime… ${percent(status.runtime.receivedBytes, status.runtime.totalBytes)}%`;
    }
    return `Downloading ${percent(model.receivedBytes, model.totalBytes)}% of ${formatBytes(model.totalBytes)}`;
  }
  if (model.state === "installed") {
    const onDisk = (model.sizeOnDisk ?? 0) + (status.runtime.sizeOnDisk ?? 0);
    return `Installed · ${formatBytes(onDisk)} on disk`;
  }
  if (model.state === "failed") return model.error ?? "The download failed";
  const runtime = status.runtime.state === "installed" ? 0 : status.runtime.totalBytes;
  const resume =
    model.receivedBytes > 0 ? ` (${percent(model.receivedBytes, model.totalBytes)}% done)` : "";
  return `Not downloaded · ${formatBytes(model.totalBytes + runtime)} download${resume}`;
}

/** The model picker: name, download size, speed and accuracy hint, and whether it is on disk. */
export function WhisperModelSelect({
  status,
  value,
  onChange,
  className,
}: {
  status: LocalSttStatus | undefined;
  value: WhisperModelId;
  onChange: (id: WhisperModelId) => void;
  className?: string;
}) {
  const current = status?.models.find((m) => m.id === value);
  return (
    <Select value={value} onValueChange={(v) => onChange(v as WhisperModelId)}>
      <SelectTrigger size="sm" className={cn("w-60", className)} aria-label="Whisper model">
        <SelectValue>
          {current ? `${current.label} · ${formatBytes(current.totalBytes)}` : value}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(status?.models ?? []).map((m) => (
          <SelectItem key={m.id} value={m.id}>
            <span className="flex w-full items-center gap-2">
              <span>{m.label}</span>
              <span className="text-2xs text-muted-foreground">
                {formatBytes(m.totalBytes)} · {m.hint}
                {m.recommended ? " · recommended" : ""}
              </span>
              {m.state === "installed" && <Check className="ml-auto size-3 text-status-done" />}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Status line, progress bar and the Download / Retry / Cancel / Delete action for a model. */
export function WhisperModelStatus({
  status,
  modelId,
}: {
  status: LocalSttStatus | undefined;
  modelId: WhisperModelId;
}) {
  const actions = useLocalSttActions();
  const model = status?.models.find((m) => m.id === modelId);
  if (!status || !model) {
    return <div className="text-2xs text-muted-foreground">Checking local Whisper…</div>;
  }
  const downloading = model.state === "downloading";
  const progress =
    status.runtime.state === "downloading"
      ? percent(status.runtime.receivedBytes, status.runtime.totalBytes)
      : percent(model.receivedBytes, model.totalBytes);
  return (
    <div className="flex min-w-0 items-center gap-3" data-testid="whisper-model-status">
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-2xs",
            model.state === "failed" || !status.supported
              ? "text-status-failed/90"
              : model.state === "installed"
                ? "text-status-done"
                : "text-muted-foreground",
          )}
          title={modelStatusText(status, model)}
        >
          {modelStatusText(status, model)}
        </div>
        {downloading && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
      {status.supported && model.state === "missing" && (
        <Button size="sm" variant="outline" onClick={() => void actions.download(model.id)}>
          <Download /> {model.receivedBytes > 0 ? "Resume" : "Download"}
        </Button>
      )}
      {status.supported && model.state === "failed" && (
        <Button size="sm" variant="outline" onClick={() => void actions.download(model.id)}>
          <RotateCw /> Retry
        </Button>
      )}
      {downloading && (
        <Button size="sm" variant="ghost" onClick={() => void actions.remove(model.id)}>
          <Loader2 className="animate-spin" /> Cancel
        </Button>
      )}
      {model.state === "installed" && (
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-label={`Delete the ${model.label} model`}
          onClick={() => void actions.remove(model.id)}
        >
          <Trash2 /> Delete
        </Button>
      )}
    </div>
  );
}
