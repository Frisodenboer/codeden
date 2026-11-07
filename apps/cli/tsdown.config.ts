import { defineConfig } from "tsdown";
// @ts-expect-error: plain .mjs build helper without type declarations
import { thirdPartyNotices } from "./scripts/third-party-notices.mjs";

/** Installed on demand into `<home>/deps` by the runner; never shipped in this package. */
const ON_DEMAND = ["@anthropic-ai/claude-agent-sdk"];

/**
 * Bundles the published `codeden` package: the CLI (with the server inlined) and the runner
 * entry; `scripts/copy-assets.mjs` then adds the drizzle migrations and the prebuilt web UI.
 *
 * Workspace packages and permissively licensed pure-JS code (Hono, zod, drizzle-orm, ws, the
 * MCP SDK, ...) are inlined, which keeps `npx codeden` to a handful of packages; their
 * licenses go into `dist/THIRD-PARTY-NOTICES.txt`. Only what must stay on disk as its own
 * package is listed in `dependencies`: native modules (node-pty, @napi-rs/keyring) and
 * playwright-core (it resolves its own files at runtime).
 *
 * The Claude Agent SDK is not redistributed: it stays external, and the build flag below makes
 * the loader install it from npm into `<home>/deps` on first use (without its platform
 * binaries; the adapter runs the user's installed `claude`).
 */
export default defineConfig({
  entry: { cli: "src/cli.ts", runner: "src/runner.ts" },
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  dts: false,
  fixedExtension: false,
  sourcemap: true,
  deps: { onlyBundle: false, neverBundle: ON_DEMAND },
  define: { __CODEDEN_CLAUDE_SDK_ON_DEMAND__: "true" },
  plugins: [thirdPartyNotices({ forbidden: ON_DEMAND })],
});
