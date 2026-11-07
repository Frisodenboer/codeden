import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** Generate a random URL-safe token (hex). */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/**
 * Load the per-install token from `file`, creating it on first run (§15). The file is
 * readable only by the user where the OS supports POSIX modes.
 */
export function ensureInstallToken(file: string): string {
  if (existsSync(file)) {
    const existing = readFileSync(file, "utf8").trim();
    if (existing.length >= 32) return existing;
  }
  const token = generateToken();
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}

/** Constant-time string comparison. */
export function tokensEqual(a: string | undefined | null, b: string): boolean {
  if (!a) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
