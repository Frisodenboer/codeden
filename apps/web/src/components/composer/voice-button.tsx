import { Loader2, Mic, MicOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useSettings } from "@/components/settings/settings-ui";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useClient } from "@/lib/api";
import { formatCombo, matchesCombo, shortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { createCloudStt } from "@/lib/voice/cloud-stt";
import { stt as browserStt, type SpeechToText } from "@/lib/voice/engines";

/**
 * The dictation engine from Settings: the browser's, or a server engine (cloud or local
 * Whisper) through `/api/stt`.
 */
function useDictationEngine(override?: SpeechToText): { engine: SpeechToText; cloud: boolean } {
  const client = useClient();
  const { settings } = useSettings();
  const choice = settings.voice.dictation.engine;
  return useMemo(() => {
    if (override) return { engine: override, cloud: false };
    if (choice === "browser") return { engine: browserStt, cloud: false };
    return { engine: createCloudStt(client, choice), cloud: true };
  }, [override, choice, client]);
}

/**
 * Dictation button (§11.3): toggles recording (or hold the push-to-talk shortcut), streams
 * text into the composer, and stays honest when no engine is available. Server engines record
 * first and transcribe when you stop.
 */
export function VoiceButton({
  baseText,
  onText,
  language,
  engine: override,
}: {
  baseText: string;
  onText: (text: string) => void;
  language?: string | null;
  engine?: SpeechToText;
}) {
  const { engine, cloud } = useDictationEngine(override);
  const { settings } = useSettings();
  const pushToTalk = settings.voice.dictation.pushToTalkShortcut;
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const base = useRef(baseText);
  const combo = shortcut("dictate").combo;

  const start = () => {
    base.current = baseText ? `${baseText.trimEnd()} ` : "";
    setRecording(true);
    engine.start({
      language,
      onText: (text) => onText(base.current + text),
      onEnd: () => {
        setRecording(false);
        setTranscribing(false);
      },
      onError: (message) => {
        setRecording(false);
        setTranscribing(false);
        toast.error("Dictation stopped", { description: message });
      },
    });
  };
  const stop = () => {
    if (cloud) setTranscribing(true);
    setRecording(false);
    engine.stop();
  };
  const toggle = () => (recording ? stop() : start());

  const handlers = useRef({ toggle, start, stop, recording });
  handlers.current = { toggle, start, stop, recording };
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!engine.supported) return;
      if (pushToTalk && matchesCombo(e, pushToTalk)) {
        e.preventDefault();
        if (!e.repeat && !handlers.current.recording) handlers.current.start();
        return;
      }
      if (matchesCombo(e, combo)) {
        e.preventDefault();
        handlers.current.toggle();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (!pushToTalk || !handlers.current.recording) return;
      // Releasing the shortcut's main key ends push-to-talk.
      const key = pushToTalk.split("+").at(-1)?.toLowerCase();
      if (key && (e.key.toLowerCase() === key || e.code.toLowerCase() === key))
        handlers.current.stop();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [combo, pushToTalk, engine.supported]);

  const label = !engine.supported
    ? "Dictation isn't available in this browser. Choose Local (Whisper) in Settings > Voice."
    : transcribing
      ? "Transcribing…"
      : recording
        ? "Stop dictation"
        : `Dictate · ${formatCombo(combo)}${pushToTalk ? ` · hold ${formatCombo(pushToTalk)}` : ""}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!engine.supported || transcribing}
            onClick={toggle}
            aria-label={label}
            aria-pressed={recording}
            className={cn(
              "relative text-muted-foreground",
              recording &&
                "bg-status-failed/12 text-status-failed hover:bg-status-failed/20 hover:text-status-failed",
            )}
          >
            {transcribing ? (
              <Loader2 className="animate-spin" />
            ) : engine.supported ? (
              <Mic />
            ) : (
              <MicOff />
            )}
            {recording && (
              <span className="absolute inset-0 animate-ping rounded-[inherit] border border-status-failed/40 [animation-duration:1.6s]" />
            )}
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
