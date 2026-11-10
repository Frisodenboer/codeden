/**
 * The desktop server's log: every line the server logs, with a timestamp, always. Its stdout
 * goes to `<home>/logs/desktop-server.log` (the main process opens it), so failures in the
 * background (a worktree that couldn't be removed, a session that failed to resume) can be
 * read after the fact instead of being dropped unless `CODEDEN_DEBUG` was set.
 */
export function serverLog(
  write: (line: string) => void = (line) => console.log(line),
  now: () => Date = () => new Date(),
): (message: string) => void {
  return (message) => write(`${now().toISOString()} [codeden] ${message}`);
}
