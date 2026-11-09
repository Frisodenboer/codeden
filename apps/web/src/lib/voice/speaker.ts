import type { Role } from "@codeden/contracts";

/** Longest session title spoken in a prefix; longer ones are cut at a word. */
export const SPEAKER_TITLE_MAX_CHARS = 40;

/** Shorten a title for speech: whole words within the limit, no trailing punctuation. */
function shortTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  if (clean.length <= SPEAKER_TITLE_MAX_CHARS) return clean.replace(/[.,;:!?-]+$/, "");
  const cut = clean.slice(0, SPEAKER_TITLE_MAX_CHARS + 1);
  const space = cut.lastIndexOf(" ");
  return (space > 10 ? cut.slice(0, space) : cut.slice(0, SPEAKER_TITLE_MAX_CHARS)).replace(
    /[\s.,;:!?-]+$/,
    "",
  );
}

/**
 * Who a read-aloud message is from (§11.3), built from the session itself so it is instant and
 * always right: "Orchestrator", "codeden project manager", "codeden-website, Improve FAQ".
 */
export function speakerName(
  session: { role: Role; title: string | null },
  projectName: string | null,
): string {
  const project = projectName?.trim() || null;
  const title = session.title?.trim() ? shortTitle(session.title) : null;
  switch (session.role) {
    case "orchestrator":
      return "Orchestrator";
    case "pm":
      return project ? `${project} project manager` : "Project manager";
    default:
      if (project && title) return `${project}, ${title}`;
      return project ? `${project} agent` : (title ?? "Agent");
  }
}

/** `text` introduced by its speaker; a colon gives the voice a natural pause. */
export function withSpeaker(speaker: string, text: string): string {
  return `${speaker}: ${text}`;
}
