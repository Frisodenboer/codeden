/**
 * Ask a provider to interrupt its running turn, with a deadline that does not depend on the
 * provider answering. The forced close is armed before the request is sent, so a request that
 * never answers (a hung CLI, a dead pipe) can't leave the turn running forever.
 *
 * Resolves when the request settles or the deadline passes, whichever comes first. The forced
 * close still runs at the deadline when the request answered sooner, so `force` must check that
 * the same turn is still open before closing it.
 */
export async function interruptWithDeadline(
  request: () => Promise<unknown>,
  timeoutMs: number,
  force: () => void,
): Promise<void> {
  const deadline = new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      force();
      resolve();
    }, timeoutMs);
    timer.unref?.();
  });
  let settled: Promise<void>;
  try {
    settled = request().then(
      () => undefined,
      () => undefined,
    );
  } catch {
    // The provider is already gone; the deadline closes the turn.
    settled = deadline;
  }
  await Promise.race([settled, deadline]);
}
