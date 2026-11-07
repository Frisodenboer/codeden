// Stand-in for npm in the self-update installer tests: "installs" a tiny codeden package into
// --prefix whose dist/cli.js prints its version. Records each call in calls.log next to the
// app folder. FAKE_NPM_FAIL=1 exits non-zero; FAKE_NPM_REPORT overrides the printed version;
// FAKE_NPM_DELAY_MS slows it down.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const prefix = args[args.indexOf("--prefix") + 1];
appendFileSync(join(dirname(prefix), "calls.log"), `${JSON.stringify(args)}\n`);
await new Promise((r) => setTimeout(r, Number(process.env.FAKE_NPM_DELAY_MS ?? 0)));
if (process.env.FAKE_NPM_FAIL === "1") {
  console.error("npm error code E404\nnpm error 404 Not Found - GET http://registry.test/codeden");
  process.exit(1);
}
const spec = args[args.indexOf("install") + 1];
const version = spec.slice(spec.lastIndexOf("@") + 1);
const root = join(prefix, "node_modules", "codeden");
mkdirSync(join(root, "dist", "web"), { recursive: true });
writeFileSync(join(root, "package.json"), JSON.stringify({ name: "codeden", version }));
const reported = process.env.FAKE_NPM_REPORT ?? version;
writeFileSync(join(root, "dist", "cli.js"), `console.log(${JSON.stringify(reported)});\n`);
writeFileSync(join(root, "dist", "runner.js"), "");
writeFileSync(join(root, "dist", "web", "index.html"), "<title>CodeDen</title>");
console.log("added 1 package in 0.1s");
