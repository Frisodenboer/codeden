import { Loader2, Mic } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useClient } from "@/lib/api";
import { cn } from "@/lib/utils";
import { transcribeRecording } from "@/lib/voice/cloud-stt";
import { recordClip } from "@/lib/voice/recorder";

const TEST_SECONDS = 5;

interface TestResult {
  text: string;
  /** Server-side transcription time. */
  elapsedMs: number | null;
  /** Converting, uploading and transcribing, as the user waits for it. */
  roundTripMs: number;
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;

/**
 * Try local Whisper (§11.3): records five seconds from the microphone, transcribes it on
 * the server with the chosen model and shows the text and how long it took.
 */
export function WhisperTest({
  disabled,
  language,
  className,
}: {
  disabled?: boolean;
  language: string | null;
  className?: string;
}) {
  const client = useClient();
  const [phase, setPhase] = useState<"idle" | "recording" | "transcribing">("idle");
  const [left, setLeft] = useState(TEST_SECONDS);
  const [result, setResult] = useState<TestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "recording") return;
    setLeft(TEST_SECONDS);
    const timer = setInterval(() => setLeft((n) => Math.max(1, n - 1)), 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const run = async () => {
    setError(null);
    setResult(null);
    setPhase("recording");
    try {
      const audio = await recordClip(TEST_SECONDS * 1000);
      setPhase("transcribing");
      const started = performance.now();
      const res = await transcribeRecording(client, audio, "local", language);
      setResult({
        text: res.text,
        elapsedMs: res.elapsedMs ?? null,
        roundTripMs: performance.now() - started,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPhase("idle");
    }
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)} data-testid="whisper-test">
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || phase !== "idle"}
          onClick={() => void run()}
        >
          {phase === "idle" ? <Mic /> : <Loader2 className="animate-spin" />}
          {phase === "recording"
            ? `Listening… ${left}s`
            : phase === "transcribing"
              ? "Transcribing…"
              : "Test"}
        </Button>
        {phase === "idle" && !result && !error && (
          <span className="text-2xs text-muted-foreground">
            Records {TEST_SECONDS} seconds, then transcribes them on this machine.
          </span>
        )}
      </div>
      {result && (
        <div className="rounded-lg border border-border bg-background/50 px-3 py-2 text-[13px]">
          <div className={cn(!result.text && "text-muted-foreground italic")}>
            {result.text ? `“${result.text}”` : "No speech was heard."}
          </div>
          <div className="mt-1 text-2xs text-muted-foreground">
            {result.elapsedMs !== null ? `Transcribed in ${seconds(result.elapsedMs)} · ` : ""}
            {seconds(result.roundTripMs)} round trip
          </div>
        </div>
      )}
      {error && <div className="text-2xs text-status-failed/90">{error}</div>}
    </div>
  );
}
