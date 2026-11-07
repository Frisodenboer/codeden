// Copies runtime assets next to the bundle: drizzle migrations, automation templates and the
// prebuilt web UI.
import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const assets = [
  ["../server/drizzle", "dist/drizzle"],
  ["../server/templates", "dist/templates"],
  ["../web/dist", "dist/web"],
];
for (const [from, to] of assets) {
  const src = resolve(root, from);
  if (!existsSync(src)) throw new Error(`Missing ${src}; build the workspace first`);
  rmSync(resolve(root, to), { recursive: true, force: true });
  cpSync(src, resolve(root, to), { recursive: true });
}
console.log("copied drizzle migrations, automation templates and web assets");
