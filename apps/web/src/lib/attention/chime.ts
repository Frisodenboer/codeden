/**
 * The attention chime: two soft rising notes synthesized with the Web Audio API, so there is no
 * audio file to ship. Browsers keep audio locked until the page has had a click or keypress, so
 * the context is created on the first gesture; before that the chime is silently skipped.
 * Nothing here throws.
 */

type AudioContextCtor = new () => AudioContext;

/** Two notes a fourth apart (E5, A5), the second slightly after the first. */
const NOTES = [
  { frequency: 659.25, offset: 0 },
  { frequency: 880, offset: 0.14 },
] as const;
const NOTE_LENGTH = 0.7;
const VOLUME = 0.2;
/** A resume that settles later than this is from an old request: skip it, don't play late. */
const LATE_MS = 1000;

/** Several blocking items within this window play one chime. */
export const CHIME_DEBOUNCE_MS = 3000;

export interface Chime {
  /** Play the chime now if audio is unlocked; otherwise do nothing. */
  play(): void;
  /** Create or resume the audio context. Call it from a user gesture. */
  unlock(): void;
  /** Unlock on the first click, tap or keypress. Returns a cleanup. */
  installUnlock(target?: EventTarget): () => void;
}

function browserAudioContext(): AudioContextCtor | undefined {
  const g = globalThis as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext;
}

function scheduleNotes(ctx: AudioContext): void {
  const start = ctx.currentTime + 0.02;
  const master = ctx.createGain();
  master.gain.value = VOLUME;
  master.connect(ctx.destination);
  for (const note of NOTES) {
    const at = start + note.offset;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(note.frequency, at);
    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, at);
    envelope.gain.exponentialRampToValueAtTime(1, at + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, at + NOTE_LENGTH);
    osc.connect(envelope).connect(master);
    osc.start(at);
    osc.stop(at + NOTE_LENGTH + 0.05);
  }
}

export function createChime(
  getCtor: () => AudioContextCtor | undefined = browserAudioContext,
  now: () => number = () => Date.now(),
): Chime {
  let context: AudioContext | null = null;

  const ensureContext = (): AudioContext | null => {
    if (context) return context;
    const Ctor = getCtor();
    if (!Ctor) return null;
    try {
      context = new Ctor();
    } catch {
      return null;
    }
    return context;
  };

  const resume = (ctx: AudioContext): Promise<void> => {
    try {
      return Promise.resolve(ctx.resume()).catch(() => undefined);
    } catch {
      return Promise.resolve();
    }
  };

  const unlock = () => {
    const ctx = ensureContext();
    if (ctx && ctx.state !== "running") void resume(ctx);
  };

  return {
    unlock,
    play() {
      try {
        // Never create the context here: without a gesture it would stay locked.
        const ctx = context;
        if (!ctx || ctx.state === "closed") return;
        if (ctx.state === "running") return scheduleNotes(ctx);
        const requested = now();
        void resume(ctx).then(() => {
          if (ctx.state === "running" && now() - requested < LATE_MS) {
            try {
              scheduleNotes(ctx);
            } catch {
              // Audio failures are never the user's problem.
            }
          }
        });
      } catch {
        // Audio failures are never the user's problem.
      }
    },
    installUnlock(target = typeof window === "undefined" ? undefined : window) {
      if (!target) return () => undefined;
      // The events browsers accept as a user gesture (pointerup covers touch).
      const events = ["pointerdown", "pointerup", "keydown"];
      const onGesture = () => {
        unlock();
        if (context?.state === "running") remove();
      };
      const remove = () => {
        for (const e of events) target.removeEventListener(e, onGesture, true);
      };
      for (const e of events) target.addEventListener(e, onGesture, true);
      return remove;
    },
  };
}

/**
 * Leading-edge debounce: the first request plays at once, requests within `windowMs` of the
 * last chime are dropped. Returns whether this request played.
 */
export function createChimeDebouncer(
  play: () => void,
  windowMs: number = CHIME_DEBOUNCE_MS,
  now: () => number = () => Date.now(),
): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const t = now();
    if (t - last < windowMs) return false;
    last = t;
    play();
    return true;
  };
}

/** The app's chime. */
export const chime: Chime = createChime();
