/** Helpers for reading the words of a parsed simple command (§11.2). */

/** Shell keywords that start a compound command (`if`, `then`, `do`, `{`, ...). */
const KEYWORDS = new Set(["if", "then", "else", "elif", "do", "while", "until", "time", "!", "{"]);

/**
 * Words that don't change what runs: elevation (`sudo`), wrappers (`env X=1`, `command`,
 * `exec`) and shell keywords that start a compound command (`if`, `then`, `do`, `{`, ...).
 */
export function unwrap(words: string[]): { tokens: string[]; elevated: boolean } {
  let elevated = false;
  let rest = words;
  for (;;) {
    const head = rest[0]?.toLowerCase();
    if (head === "sudo" || head === "doas" || head === "runas" || head === "gsudo") {
      elevated = true;
      rest = rest.slice(1).filter((t, i) => !(i === 0 && t.startsWith("-")));
    } else if (head === "env" || head === "command" || head === "exec" || head === "nohup") {
      rest = rest.slice(1);
    } else if (head && KEYWORDS.has(head)) {
      rest = rest.slice(1);
    } else if (head && /^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
      rest = rest.slice(1);
    } else break;
  }
  return { tokens: rest, elevated };
}

/** The program a command word names, lower-cased, without its directory or extension. */
export const binName = (token: string | undefined): string =>
  (token ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    ?.toLowerCase()
    .replace(/\.(exe|cmd|bat|ps1)$/, "") ?? "";
