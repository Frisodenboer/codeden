import { Mic, MicOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCombo, matchesCombo, shortcut } from "@/lib/shortcuts";
import { cn } from "@/lib/utils";
import { stt as defaultStt, type SpeechToText } from "@/lib/voice/engines";

/**
 * Dictation button (§11.3): toggles recording, streams text into the composer, and stays
 * honest when the browser has no speech recognition.
 */
export function VoiceButton({
  baseText,
  onText,
  language,
  engine = defaultStt,
}: {
  baseText: string;
  onText: (text: string) => void;
  language?: string | null;
  engine?: SpeechToText;
}) {
  const [recording, setRecording] = useState(false);
  const base = useRef(baseText);
  const combo = shortcut("dictate").combo;

  const start = () => {
    base.current = baseText ? `${baseText.trimEnd()} ` : "";
    setRecording(true);
    engine.start({
      language,
      onText: (text) => onText(base.current + text),
      onEnd: () => setRecording(false),
      onError: (message) => {
        setRecording(false);
        toast.error("Dictation stopped", { description: message });
      },
    });
  };
  const toggle = () => (recording ? engine.stop() : start());

  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (matchesCombo(e, combo)) {
        e.preventDefault();
        if (engine.supported) toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [combo, engine.supported]);

  const label = !engine.supported
    ? "Dictation isn't supported in this browser"
    : recording
      ? "Stop dictation"
      : `Dictate · ${formatCombo(combo)}`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={!engine.supported}
            onClick={toggle}
            aria-label={label}
            aria-pressed={recording}
            className={cn(
              "relative text-muted-foreground",
              recording &&
                "bg-status-failed/12 text-status-failed hover:bg-status-failed/20 hover:text-status-failed",
            )}
          >
            {engine.supported ? <Mic /> : <MicOff />}
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
