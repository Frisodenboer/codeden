function countNewlines(text: string): number {
  let n = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n++;
  return n;
}

/**
 * Bounded terminal history: keeps at most `maxLines` lines and `maxChars` characters
 * (whichever is hit first), dropping the oldest output. Replayed into a fresh xterm view
 * when a client (re)attaches.
 */
export class Scrollback {
  private chunks: string[] = [];
  private chars = 0;
  private lines = 0;

  constructor(
    readonly maxLines = 5_000,
    readonly maxChars = 8 * 1024 * 1024,
  ) {}

  get size(): { chars: number; lines: number } {
    return { chars: this.chars, lines: this.lines };
  }

  append(data: string): void {
    if (!data) return;
    this.chunks.push(data);
    this.chars += data.length;
    this.lines += countNewlines(data);
    this.trim();
  }

  toString(): string {
    if (this.chunks.length > 1) this.chunks = [this.chunks.join("")];
    return this.chunks[0] ?? "";
  }

  private trim(): void {
    // Drop whole chunks while the remainder still fits the limits.
    while (this.chunks.length > 1 && (this.chars > this.maxChars || this.lines > this.maxLines)) {
      const first = this.chunks[0] as string;
      const firstLines = countNewlines(first);
      const charsAfter = this.chars - first.length;
      const linesAfter = this.lines - firstLines;
      if (charsAfter < this.maxChars && linesAfter < this.maxLines) break;
      this.chunks.shift();
      this.chars = charsAfter;
      this.lines = linesAfter;
    }
    if (this.chars <= this.maxChars && this.lines <= this.maxLines) return;
    // Cut inside the oldest chunk.
    let first = this.chunks[0] as string;
    if (this.chars > this.maxChars) {
      const cut = this.chars - this.maxChars;
      this.lines -= countNewlines(first.slice(0, cut));
      first = first.slice(cut);
      this.chars -= cut;
    }
    while (this.lines > this.maxLines) {
      const nl = first.indexOf("\n");
      if (nl === -1) break;
      first = first.slice(nl + 1);
      this.chars -= nl + 1;
      this.lines -= 1;
    }
    this.chunks[0] = first;
  }
}
