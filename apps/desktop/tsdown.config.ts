import { defineConfig } from "tsdown";
// @ts-expect-error: plain .mjs build helper without type declarations
import { thirdPartyNotices } from "../cli/scripts/third-party-notices.mjs";

/** Installed on demand into `<home>/deps`; never shipped in the app. */
const ON_DEMAND = ["@anthropic-ai/claude-agent-sdk"];

/**
 * Bundles the desktop app (§17) into `dist/`:
 * - `main.js`: the Electron main process (ESM; `electron` stays external).
 * - `preload.cjs`: the sandboxed preload (CommonJS, as sandboxed preloads require).
 * - `server.js` + `runner.js`: the same server and runner the `codeden` CLI ships, started
 *   by the main process on the Electron binary as Node.js (`ELECTRON_RUN_AS_NODE`).
 * `scripts/copy-assets.mjs` then adds the migrations, templates, web UI and icons.
 *
 * As in the CLI, pure-JS code is inlined (licenses in `dist/THIRD-PARTY-NOTICES.txt`); the
 * native modules and playwright-core (`dependencies`) stay packages on disk, and the Claude
 * Agent SDK is never bundled: it is installed on first use, without npm (§17).
 */
export default defineConfig([
  {
    entry: { main: "src/main/main.ts" },
    format: "esm",
    platform: "node",
    target: "node24",
    outDir: "dist",
    clean: true,
    dts: false,
    fixedExtension: false,
    sourcemap: true,
    deps: { onlyBundle: false, neverBundle: ["electron"] },
    plugins: [thirdPartyNotices({ fileName: "THIRD-PARTY-NOTICES-APP.txt" })],
  },
  {
    entry: { preload: "src/preload/preload.ts" },
    format: "cjs",
    platform: "node",
    target: "node24",
    outDir: "dist",
    clean: false,
    dts: false,
    fixedExtension: true,
    sourcemap: false,
    deps: { onlyBundle: false, neverBundle: ["electron"] },
  },
  {
    entry: { server: "src/server/host.ts", runner: "src/server/runner.ts" },
    format: "esm",
    platform: "node",
    target: "node24",
    outDir: "dist",
    clean: false,
    dts: false,
    fixedExtension: false,
    sourcemap: true,
    deps: { onlyBundle: false, neverBundle: ON_DEMAND },
    define: { __CODEDEN_CLAUDE_SDK_ON_DEMAND__: "true" },
    plugins: [thirdPartyNotices({ forbidden: ON_DEMAND })],
  },
]);
