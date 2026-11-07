/**
 * Runner process entry. Started detached by the server:
 *   node main.js --home <dir> [--fake]
 */
import { parseArgs } from "node:util";
import { startRunner } from "./runner";

const { values } = parseArgs({
  options: {
    home: { type: "string" },
    fake: { type: "boolean", default: false },
  },
  allowPositionals: false,
});

const home = values.home ?? process.env.CODEDEN_HOME;
if (!home) {
  console.error("codeden runner: --home or CODEDEN_HOME is required");
  process.exit(2);
}

const log = (m: string) => console.log(`[${new Date().toISOString()}] ${m}`);

try {
  const runner = await startRunner({
    home,
    enableFakeProvider: values.fake,
    log,
    onShutdown: () => process.exit(0),
  });
  const stop = () => void runner.close().then(() => process.exit(0));
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
} catch (error) {
  log(`failed to start: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
