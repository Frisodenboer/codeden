import type { QuietHours, Settings } from "@codeden/contracts";

/**
 * Turn an assistant's markdown into something pleasant to hear (§11.3): code blocks and
 * markdown syntax are removed, links keep their text, and long text is cut to a couple of
 * sentences (the utility model compresses it server-side when that job is on).
 */
export function stripForSpeech(markdown: string, maxSentences = 3): string {
  let text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*\|.*\|\s*$/gm, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const sentences = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) ?? [];
  if (sentences.length > maxSentences) text = sentences.slice(0, maxSentences).join("").trim();
  return text;
}

function minutes(hhmm: string): number {
  const [h = "0", m = "0"] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/** True when `now` falls inside the quiet-hours window (handles windows across midnight). */
export function inQuietHours(quiet: QuietHours | null, now: Date): boolean {
  if (!quiet) return false;
  const start = minutes(quiet.start);
  const end = minutes(quiet.end);
  const current = now.getHours() * 60 + now.getMinutes();
  return start <= end ? current >= start && current < end : current >= start || current < end;
}

/** Whether a finished turn should be read aloud right now. */
export function shouldReadAloud(
  settings: Settings,
  ctx: { now: Date; focused: boolean; sessionMuted?: boolean },
): boolean {
  const ra = settings.voice.readAloud;
  if (!ra.enabled || ctx.sessionMuted) return false;
  if (ra.onlyWhenUnfocused && ctx.focused) return false;
  return !inQuietHours(ra.quietHours, ctx.now);
}
