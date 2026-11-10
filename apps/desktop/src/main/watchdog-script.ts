/**
 * The quit watchdog's script (run as Node.js): kill `pid` after `ms`, unless its stdin (a pipe
 * from the app) closes first, which happens the moment the app exits. Waiting on the pipe
 * rather than the pid means it can never hit another process that reuses the pid.
 * Arguments: `<pid> <ms>`.
 */
export const WATCHDOG_SCRIPT = `
const [pid, ms] = process.argv.slice(-2).map(Number);
setTimeout(() => { try { process.kill(pid, "SIGKILL"); } catch {} process.exit(0); }, ms);
process.stdin.on("end", () => process.exit(0)).on("error", () => process.exit(0)).resume();
`;
