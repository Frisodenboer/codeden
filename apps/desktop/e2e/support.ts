import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/** The unpacked app electron-builder made for this OS (`pnpm desktop:build`). */
export function unpackedApp(): string {
  const candidates = {
    win32: [join(root, "release", "win-unpacked", "CodeDen.exe")],
    darwin: ["mac-arm64", "mac", "mac-universal"].map((d) =>
      join(root, "release", d, "CodeDen.app", "Contents", "MacOS", "CodeDen"),
    ),
    linux: [join(root, "release", "linux-unpacked", "codeden")],
  }[process.platform as "win32" | "darwin" | "linux"];
  const found = candidates?.find((c) => existsSync(c));
  if (!found) throw new Error("No unpacked app: run `pnpm desktop:build` first");
  return found;
}
