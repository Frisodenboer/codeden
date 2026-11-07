#!/usr/bin/env node
// Run the live smoke tests against the installed CLIs (real turns, small cost):
//   pnpm --filter @codeden/providers test:live [-- -t claude]
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const vitest = path.join(path.dirname(require.resolve("vitest/package.json")), "vitest.mjs");
const result = spawnSync(process.execPath, [vitest, "run", "test/live", ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, CODEDEN_LIVE: "1" },
});
process.exit(result.status ?? 1);
