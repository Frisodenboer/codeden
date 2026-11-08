/** Microphone recording with `MediaRecorder`, shared by server-side dictation and the tests. */

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((t) =>
    MediaRecorder.isTypeSupported(t),
  );
}

/** True when this browser can record the microphone. */
export function canRecord(): boolean {
  return (
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof MediaRecorder !== "undefined"
  );
}

export interface Recording {
  /** Stop and return the clip (empty when nothing was captured). */
  stop(): Promise<Blob>;
  /** Resolves with the clip once recording stops. */
  readonly stopped: Promise<Blob>;
}

/** Ask for the microphone and start recording. Rejects when access is blocked. */
export async function startRecording(): Promise<Recording> {
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    throw new Error("Microphone access was blocked.");
  }
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      resolve(new Blob(chunks, { type: (recorder.mimeType || "audio/webm").split(";")[0] }));
    };
  });
  recorder.start();
  return {
    stopped,
    stop() {
      if (recorder.state !== "inactive") recorder.stop();
      return stopped;
    },
  };
}

/** Record for `ms` milliseconds (the Settings test). */
export async function recordClip(ms: number): Promise<Blob> {
  const recording = await startRecording();
  await new Promise((r) => setTimeout(r, ms));
  return recording.stop();
}
