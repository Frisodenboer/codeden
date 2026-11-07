import { defineConfig } from "tsdown";

/**
 * Bundles the published `codeden` package: the CLI (with the server inlined) and the runner
 * entry; `scripts/copy-assets.mjs` then adds the drizzle migrations and the prebuilt web UI.
 * Workspace packages are bundled; third-party runtime deps stay external and are installed
 * with the package (listed in `dependencies`): native modules (node-pty, @napi-rs/keyring),
 * the Claude Agent SDK (large, ships its own CLI assets) and the MCP SDK among them.
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
});
