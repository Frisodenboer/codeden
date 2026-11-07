import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { type RunnerEvent, RunnerEventMessage } from "@codeden/contracts";

interface JournalState {
  runnerId: string;
  /** Highest seq ever assigned. */
  lastSeq: number;
  /** Highest seq the server acknowledged. */
  ackedSeq: number;
}

/**
 * Durable runner event journal (§4.2). Events are appended to `journal.jsonl` with a
 * monotonically increasing seq and kept until the server acks them, so nothing is lost
 * while the server is away. `state.json` holds the stable runner id and seq counters.
 *
 * TODO(M1): batch fsyncs and compact lazily instead of rewriting on every ack.
 */
export class Journal {
  private readonly file: string;
  private readonly stateFile: string;
  private state: JournalState;
  private entries: RunnerEventMessage[] = [];

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "journal.jsonl");
    this.stateFile = join(dir, "state.json");
    this.state = this.loadState();
    this.entries = this.loadEntries().filter((e) => e.seq > this.state.ackedSeq);
    const maxSeq = this.entries.at(-1)?.seq ?? 0;
    this.state.lastSeq = Math.max(this.state.lastSeq, maxSeq);
  }

  get runnerId(): string {
    return this.state.runnerId;
  }

  get lastSeq(): number {
    return this.state.lastSeq;
  }

  get unacked(): number {
    return this.entries.length;
  }

  /** Assign the next seq, persist the event, and return the wire message. */
  append(event: RunnerEvent): RunnerEventMessage {
    this.state.lastSeq += 1;
    const msg: RunnerEventMessage = {
      type: "event",
      seq: this.state.lastSeq,
      ts: new Date().toISOString(),
      event,
    };
    appendFileSync(this.file, `${JSON.stringify(msg)}\n`);
    this.entries.push(msg);
    return msg;
  }

  /** Drop everything with `seq <= seq` (cumulative ack). */
  ack(seq: number): void {
    if (seq <= this.state.ackedSeq) return;
    this.state.ackedSeq = Math.min(seq, this.state.lastSeq);
    this.entries = this.entries.filter((e) => e.seq > seq);
    this.rewrite();
  }

  /** Unacked events after `seq`, oldest first (for replay on resume). */
  after(seq: number): RunnerEventMessage[] {
    return this.entries.filter((e) => e.seq > seq);
  }

  private loadState(): JournalState {
    try {
      const raw = JSON.parse(readFileSync(this.stateFile, "utf8")) as Partial<JournalState>;
      if (typeof raw.runnerId === "string") {
        return { runnerId: raw.runnerId, lastSeq: raw.lastSeq ?? 0, ackedSeq: raw.ackedSeq ?? 0 };
      }
    } catch {
      // first run
    }
    const fresh = { runnerId: randomUUID(), lastSeq: 0, ackedSeq: 0 };
    this.writeState(fresh);
    return fresh;
  }

  private loadEntries(): RunnerEventMessage[] {
    if (!existsSync(this.file)) return [];
    const out: RunnerEventMessage[] = [];
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const parsed = RunnerEventMessage.safeParse(safeJson(line));
      if (parsed.success) out.push(parsed.data); // a torn last line is skipped
    }
    return out.sort((a, b) => a.seq - b.seq);
  }

  private rewrite(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, this.entries.map((e) => `${JSON.stringify(e)}\n`).join(""));
    renameSync(tmp, this.file);
    this.writeState(this.state);
  }

  private writeState(state: JournalState): void {
    const tmp = `${this.stateFile}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`);
    renameSync(tmp, this.stateFile);
  }
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
