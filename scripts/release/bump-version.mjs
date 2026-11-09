#!/usr/bin/env node
// Bumps the CodeDen release version everywhere it is written, for the Release workflow's
// "patch / minor / major" choice:
//   apps/cli/package.json, apps/desktop/package.json, packages/contracts/src/version.ts
//   (SOURCE_VERSION), and CHANGELOG.md (the [Unreleased] notes become the new version).
//
// Usage: node scripts/release/bump-version.mjs <patch|minor|major> [repo root]
// Prints the new version (e.g. 0.4.1) on stdout.

import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const BUMPS = ["patch", "minor", "major"];

/** The next semantic version: "0.4.0" + "patch" -> "0.4.1", + "minor" -> "0.5.0". */
export function nextVersion(current, bump) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!match) throw new Error(`Not a plain x.y.z version: ${current}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unknown bump "${bump}" (expected ${BUMPS.join(", ")})`);
}

/** Replaces the `"version"` field of a package.json, keeping its formatting. */
export function setPackageVersion(text, version) {
  const next = text.replace(/("version"\s*:\s*")[^"]*(")/, `$1${version}$2`);
  if (next === text && !text.includes(`"version": "${version}"`)) {
    throw new Error("No version field found in package.json");
  }
  return next;
}

/** Replaces `SOURCE_VERSION` in packages/contracts/src/version.ts. */
export function setSourceVersion(text, version) {
  const pattern = /(export const SOURCE_VERSION = ")[^"]*(";)/;
  if (!pattern.test(text)) throw new Error("SOURCE_VERSION not found in version.ts");
  return text.replace(pattern, `$1${version}$2`);
}

/**
 * Turns the changelog's `## [Unreleased]` notes into `## [version] - date`, leaving an empty
 * `[Unreleased]` section above it. With no unreleased notes the version still gets a section,
 * so every release has a heading.
 */
export function releaseChangelog(text, version, date) {
  const heading = "## [Unreleased]";
  const at = text.indexOf(heading);
  if (at === -1) throw new Error("CHANGELOG.md has no ## [Unreleased] section");
  const after = at + heading.length;
  const nextSection = text.indexOf("\n## [", after);
  const notes = text.slice(after, nextSection === -1 ? undefined : nextSection).trim();
  const body = notes.length > 0 ? notes : "Maintenance release.";
  const rest = nextSection === -1 ? "" : text.slice(nextSection + 1);
  return `${text.slice(0, at)}${heading}\n\n## [${version}] - ${date}\n\n${body}\n\n${rest}`;
}

/** Applies a bump to the repository at `root` and returns the new version. */
export function bumpRepository(root, bump, date = new Date().toISOString().slice(0, 10)) {
  const cliPath = join(root, "apps/cli/package.json");
  const desktopPath = join(root, "apps/desktop/package.json");
  const sourcePath = join(root, "packages/contracts/src/version.ts");
  const changelogPath = join(root, "CHANGELOG.md");

  const current = JSON.parse(readFileSync(cliPath, "utf8")).version;
  const desktop = JSON.parse(readFileSync(desktopPath, "utf8")).version;
  if (desktop !== current) {
    throw new Error(`apps/desktop is ${desktop} but apps/cli is ${current}; fix that first`);
  }
  const version = nextVersion(current, bump);

  writeFileSync(cliPath, setPackageVersion(readFileSync(cliPath, "utf8"), version));
  writeFileSync(desktopPath, setPackageVersion(readFileSync(desktopPath, "utf8"), version));
  writeFileSync(sourcePath, setSourceVersion(readFileSync(sourcePath, "utf8"), version));
  writeFileSync(
    changelogPath,
    releaseChangelog(readFileSync(changelogPath, "utf8"), version, date),
  );
  return version;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [bump, root = process.cwd()] = process.argv.slice(2);
  try {
    process.stdout.write(`${bumpRepository(resolve(root), bump)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
