// Rolldown plugin: writes dist/THIRD-PARTY-NOTICES.txt with the name, version, license and
// license text of every third-party package inlined into the bundle, so the notices travel
// with the published package. Fails the build if a `forbidden` package (one we must not
// redistribute) ends up inlined.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";

/** The package root that owns a bundled module path, or null for workspace sources. */
function packageRoot(id) {
  const marker = `${sep}node_modules${sep}`;
  const at = id.lastIndexOf(marker);
  if (at === -1) return null;
  const rest = id.slice(at + marker.length).split(sep);
  const depth = rest[0]?.startsWith("@") ? 2 : 1;
  return join(id.slice(0, at + marker.length), ...rest.slice(0, depth));
}

function licenseText(root) {
  const file = readdirSync(root).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name));
  return file ? readFileSync(join(root, file), "utf8").trim() : null;
}

export function thirdPartyNotices({ forbidden = [], fileName = "THIRD-PARTY-NOTICES.txt" } = {}) {
  return {
    name: "codeden-third-party-notices",
    generateBundle() {
      const roots = new Set();
      for (const id of this.getModuleIds()) {
        const root = packageRoot(id.replace(/^\0/, "").split("?")[0]);
        if (root && existsSync(join(root, "package.json"))) roots.add(root);
      }
      const seen = new Map();
      for (const root of roots) {
        const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
        const key = `${pkg.name}@${pkg.version}`;
        if (forbidden.includes(pkg.name)) {
          this.error(`${pkg.name} must not be bundled into the published package`);
        }
        if (!pkg.name || seen.has(key)) continue;
        const license = typeof pkg.license === "string" ? pkg.license : "see package";
        const text = licenseText(root) ?? "";
        seen.set(key, `${key} (${license})\n\n${text}`.trim());
      }
      const entries = [...seen.entries()].sort(([a], [b]) => a.localeCompare(b));
      const body = entries.map(([, notice]) => notice).join(`\n\n${"-".repeat(72)}\n\n`);
      this.emitFile({
        type: "asset",
        fileName,
        source: `The codeden bundle includes the following third-party packages.\n\n${body}\n`,
      });
    },
  };
}
