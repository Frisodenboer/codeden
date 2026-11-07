/** Composer `@` mention and `/` command detection. Pure, so it's easy to test. */

export interface Trigger {
  kind: "mention" | "command";
  /** Text typed after the trigger character. */
  query: string;
  /** Index of the trigger character in the text. */
  start: number;
}

/**
 * Find an active trigger ending at the caret:
 * - `@query` anywhere after whitespace or at the start;
 * - `/query` only at the very start of the message (commands and skills).
 */
export function detectTrigger(text: string, caret: number): Trigger | null {
  const before = text.slice(0, caret);
  const mention = /(^|\s)@([\w./\\-]*)$/.exec(before);
  if (mention) {
    const query = mention[2] ?? "";
    return { kind: "mention", query, start: caret - query.length - 1 };
  }
  const command = /^\/([\w-]*)$/.exec(before);
  if (command) return { kind: "command", query: command[1] ?? "", start: 0 };
  return null;
}

/** Replace the trigger with `replacement` and return the new text and caret. */
export function applyTrigger(
  text: string,
  caret: number,
  trigger: Trigger,
  replacement: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, trigger.start)}${replacement} ${text.slice(caret)}`;
  return { text: next, caret: trigger.start + replacement.length + 1 };
}
