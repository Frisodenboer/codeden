// Copies runtime assets next to the bundle, like the CLI build: drizzle migrations,
// automation templates and the prebuilt web UI, plus the app's tray, badge and window icons.
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const assets = [
  ["../server/drizzle", "dist/drizzle"],
  ["../server/templates", "dist/templates"],
  ["../web/dist", "dist/web"],
  ["assets", "dist/assets"],
];
for (const [from, to] of assets) {
  const src = resolve(root, from);
  if (!existsSync(src)) throw new Error(`Missing ${src}; build the workspace first`);
  rmSync(resolve(root, to), { recursive: true, force: true });
  cpSync(src, resolve(root, to), { recursive: true });
}
console.log("copied drizzle migrations, automation templates, web assets and icons");
