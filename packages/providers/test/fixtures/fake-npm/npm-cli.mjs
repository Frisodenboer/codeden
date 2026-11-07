// Stand-in for npm in the Claude SDK install tests. Records each call, then "installs" a tiny
// SDK into --prefix. FAKE_NPM_FAIL=1 exits non-zero; FAKE_NPM_DELAY_MS slows it down.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
appendFileSync(join(prefix, "calls.log"), `${JSON.stringify(args)}\n`);
await new Promise((r) => setTimeout(r, Number(process.env.FAKE_NPM_DELAY_MS ?? 0)));
if (process.env.FAKE_NPM_FAIL === "1") {
  console.error("npm error code E404\nnpm error 404 Not Found");
  process.exit(1);
}
const spec = args[args.indexOf("install") + 1];
const at = spec.lastIndexOf("@");
const name = spec.slice(0, at);
const version = process.env.FAKE_NPM_VERSION ?? spec.slice(at + 1);
const dir = join(prefix, "node_modules", ...name.split("/"));
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "package.json"),
  JSON.stringify({ name, version, type: "module", exports: { ".": { default: "./sdk.mjs" } } }),
);
writeFileSync(join(dir, "sdk.mjs"), "export function query() { return 'fake'; }\n");
console.log(`added 1 package in 0.1s`);
