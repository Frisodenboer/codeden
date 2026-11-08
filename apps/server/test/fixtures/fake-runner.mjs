// A stand-in for the runner process, for launcher tests. Started like the runner
// (`... --home <dir>`); behaves as FAKE_RUNNER_MODE says:
//   slow  - wait FAKE_RUNNER_DELAY_MS, write a lock file, then stay alive until killed;
//   crash - write an error to stderr and exit 3 at once;
//   hang  - never write a lock, stay alive until killed.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const home = process.argv[process.argv.indexOf("--home") + 1];
const mode = process.env.FAKE_RUNNER_MODE ?? "slow";
const delay = Number(process.env.FAKE_RUNNER_DELAY_MS ?? "0");

if (mode === "crash") {
  console.log("fake runner: loading");
  console.error("fake runner: boom, cannot load the provider registry");
  process.exit(3);
}

setInterval(() => undefined, 1000);
if (mode === "slow") {
  setTimeout(() => {
    mkdirSync(join(home, "runner"), { recursive: true });
    writeFileSync(
      join(home, "runner", "runner.json"),
      JSON.stringify({
        pid: process.pid,
        port: 1,
        token: "t".repeat(32),
        version: "0.0.0-fake",
        protocolVersion: 1,
        runnerId: "fake-runner",
        startedAt: new Date().toISOString(),
      }),
    );
  }, delay);
}
