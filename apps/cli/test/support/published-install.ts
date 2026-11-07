/**
 * A "published-style" copy of the current build for self-update tests (§16): `dist/` and
 * `package.json` copied out of the repository (so the launcher sees an npm install, not a
 * source checkout), optionally relabelled. With `linkDeps`, the native modules and
 * playwright-core are linked into `<base>/node_modules`, where both this copy and versions
 * installed under `<base>/...` find them without a network install.
 */
import { cpSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { CLI_ROOT } from "./fake-registry";

const RUNTIME_DEPS = ["node-pty", "playwright-core", "@napi-rs/keyring"];

export function installPublishedCopy(
  base: string,
  opts: { version?: string; linkDeps?: boolean } = {},
): string {
  const root = join(base, "install", "node_modules", "codeden");
  mkdirSync(root, { recursive: true });
  cpSync(join(CLI_ROOT, "dist"), join(root, "dist"), { recursive: true });
  const pkg = JSON.parse(readFileSync(join(CLI_ROOT, "package.json"), "utf8"));
  if (opts.version) pkg.version = opts.version;
  writeFileSync(join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  if (opts.linkDeps) linkRuntimeDeps(base);
  return join(root, "dist", "cli.js");
}

/** Link the CLI's runtime dependencies (from the workspace install) into `<base>/node_modules`. */
export function linkRuntimeDeps(base: string): void {
  const require = createRequire(join(CLI_ROOT, "package.json"));
  for (const dep of RUNTIME_DEPS) {
    const target = realpathSync.native(dirname(require.resolve(`${dep}/package.json`)));
    const link = join(base, "node_modules", ...dep.split("/"));
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
  }
}
