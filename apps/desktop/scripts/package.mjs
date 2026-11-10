// Packages the desktop app with electron-builder (§17). Run after `pnpm build`.
//
//   node scripts/package.mjs [--dir] [--publish never|always] [--arch x64|arm64 ...]
//
// --dir      unpacked app only (release/<platform>-unpacked), no installer: fast, for tests.
// --publish  `always` uploads installers and update metadata to the GitHub Release (CI).
// --arch     architectures to build (default: the host's; macOS release builds pass both).
//
// Steps: stage the app in .stage/app (dist/ plus a package.json naming the runtime
// dependencies), install those with npm (production only, plus the keychain module's binary
// for every target architecture), then run electron-builder on the stage. pnpm's symlinked
// node_modules never reach the app.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Arch, build, Platform } from "electron-builder";
import config from "../electron-builder.config.mjs";

const root = resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    dir: { type: "boolean", default: false },
    publish: { type: "string", default: "never" },
    arch: { type: "string", multiple: true },
  },
});
const archs = values.arch?.length ? values.arch : [process.arch];
const readdirSafe = (dir) => (existsSync(dir) ? readdirSync(dir) : []);
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const require = createRequire(join(root, "package.json"));
const electronVersion = JSON.parse(
  readFileSync(require.resolve("electron/package.json"), "utf8"),
).version;

if (!existsSync(join(root, "dist", "main.js")) || !existsSync(join(root, "dist", "web"))) {
  throw new Error("apps/desktop/dist is missing: run `pnpm build` first");
}

// 1. Stage.
const stage = join(root, ".stage", "app");
rmSync(join(root, ".stage"), { recursive: true, force: true, maxRetries: 3 });
mkdirSync(stage, { recursive: true });
cpSync(join(root, "dist"), join(stage, "dist"), {
  recursive: true,
  filter: (src) => !src.endsWith(".map"),
});
writeFileSync(
  join(stage, "package.json"),
  `${JSON.stringify(
    {
      name: "codeden",
      productName: "CodeDen",
      version: pkg.version,
      description: "A local-first harness for coding agents.",
      author: "Leon van Zyl",
      license: "MIT",
      homepage: "https://www.codeden.app",
      type: "module",
      main: "dist/main.js",
      dependencies: pkg.dependencies,
    },
    null,
    2,
  )}\n`,
);
for (const file of ["LICENSE"]) {
  const from = resolve(root, "..", "cli", file);
  if (existsSync(from)) cpSync(from, join(stage, file));
}

// 2. Runtime dependencies (native modules are Node-API: the same binaries work in Electron).
const npm = (args) => {
  // Every argument is a fixed flag or a package spec, so joining them for the Windows shell is safe.
  const result =
    process.platform === "win32"
      ? spawnSync(`npm ${args.join(" ")}`, { cwd: stage, stdio: "inherit", shell: true })
      : spawnSync("npm", args, { cwd: stage, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`npm ${args.join(" ")} failed`);
};
npm(["install", "--omit=dev", "--no-audit", "--no-fund", "--no-package-lock"]);
const keyring = JSON.parse(
  readFileSync(join(stage, "node_modules", "@napi-rs", "keyring", "package.json"), "utf8"),
);
const keyringBinary = (arch) =>
  ({
    win32: `@napi-rs/keyring-win32-${arch}-msvc`,
    darwin: `@napi-rs/keyring-darwin-${arch}`,
    linux: `@napi-rs/keyring-linux-${arch}-gnu`,
  })[process.platform];
const missing = archs
  .map(keyringBinary)
  .filter((name) => name && !existsSync(join(stage, "node_modules", ...name.split("/"))));
if (missing.length) {
  npm([
    "install",
    "--no-save",
    "--force",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    ...missing.map((name) => `${name}@${keyring.version}`),
  ]);
}

// node-pty forks terminals through a prebuilt `spawn-helper` (macOS, Linux). npm doesn't keep
// its executable bit when it extracts the package, and every terminal then fails with
// "posix_spawnp failed". Restore it here, before electron-builder signs the app.
const ptyRoot = join(stage, "node_modules", "node-pty");
for (const dir of [
  "build/Release",
  ...readdirSafe(join(ptyRoot, "prebuilds")).map((d) => `prebuilds/${d}`),
]) {
  const helper = join(ptyRoot, dir, "spawn-helper");
  if (existsSync(helper)) chmodSync(helper, 0o755);
}

// 3. Build.
const platform = { win32: Platform.WINDOWS, darwin: Platform.MAC, linux: Platform.LINUX }[
  process.platform
];
const archList = archs.map((a) => Arch[a]);
if (archList.some((a) => a === undefined)) throw new Error(`Unknown --arch in ${archs.join(", ")}`);
const hostOnly = archs.length === 1 && archs[0] === process.arch;
const targets = platform.createTarget(values.dir ? ["dir"] : null, ...archList);
const artifacts = await build({
  projectDir: root,
  targets,
  publish: values.publish,
  config: {
    ...config,
    electronVersion,
    // The installed Electron for host builds; electron-builder downloads other architectures.
    // (The electron package downloads its binary on first `require`.)
    ...(hostOnly ? { electronDist: resolve(require("electron"), "..") } : {}),
  },
});
for (const file of artifacts) console.log(`built ${file}`);
