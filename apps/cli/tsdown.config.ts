import { defineConfig } from "tsdown";
// @ts-expect-error: plain .mjs build helper without type declarations
import { thirdPartyNotices } from "./scripts/third-party-notices.mjs";

/**
 * Bundles the published `codeden` package: the CLI (with the server inlined) and the runner
 * entry; `scripts/copy-assets.mjs` then adds the drizzle migrations and the prebuilt web UI.
 *
 * Workspace packages and pure-JS third-party code (Hono, zod, drizzle-orm, ws, the MCP SDK,
 * the Claude Agent SDK's JS entry, ...) are inlined, which keeps `npx codeden` to a handful of
 * packages. Only what must stay on disk as its own package is listed in `dependencies` and kept
 * external: native modules (node-pty, @napi-rs/keyring) and playwright-core (it resolves its
 * own files at runtime). The Claude adapter always passes `pathToClaudeCodeExecutable` (the
 * user's installed `claude`), so the SDK's platform binary packages are never needed.
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
  deps: { onlyBundle: false },
  plugins: [thirdPartyNotices()],
});
