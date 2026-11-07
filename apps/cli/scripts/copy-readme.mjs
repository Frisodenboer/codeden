// Runs before `npm pack` / `npm publish`: copies the repository README into the package so it
// shows on npm, with relative links made absolute (npm renders the README outside the repo).
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO = "https://github.com/leonvanzyl/codeden";
const RAW = "https://raw.githubusercontent.com/leonvanzyl/codeden/main";

const root = resolve(import.meta.dirname, "..");
const source = readFileSync(resolve(root, "../../README.md"), "utf8");

const absolute = (target) => {
  if (/^(?:[a-z]+:|#|\/\/)/i.test(target)) return target;
  const path = target.replace(/^\.\//, "");
  return /\.(?:png|jpe?g|gif|svg|webp)$/i.test(path)
    ? `${RAW}/${path}`
    : `${REPO}/blob/main/${path}`;
};

// Every `](target)`, including the outer link of a badge (`[![alt](img)](target)`).
const readme = source.replace(/\]\(([^)\s]+)\)/g, (_, target) => `](${absolute(target)})`);
writeFileSync(resolve(root, "README.md"), readme);
console.log("copied README.md into the package");
