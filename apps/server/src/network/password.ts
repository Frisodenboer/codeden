import { randomBytes, randomInt, type ScryptOptions, scrypt, timingSafeEqual } from "node:crypto";
import { passwordProblem } from "@codeden/contracts";
import { PASSPHRASE_WORDS } from "./words";

/** scrypt cost: N=2^15, r=8, p=1 (about 32 MiB and tens of milliseconds per hash). */
const DEFAULT_COST = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const SALT_BYTES = 16;

function scryptAsync(password: string, salt: Buffer, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const maxmem = 256 * (opts.N ?? DEFAULT_COST.N) * (opts.r ?? DEFAULT_COST.r) + 1024 * 1024;
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...opts, maxmem }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/**
 * Hash a network-access password with scrypt and a random salt:
 * `scrypt$<N>$<r>$<p>$<salt b64>$<hash b64>`. The password itself is never stored.
 */
export async function hashPassword(
  password: string,
  cost: { N: number; r: number; p: number } = DEFAULT_COST,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password, salt, cost);
  return ["scrypt", cost.N, cost.r, cost.p, salt.toString("base64"), key.toString("base64")].join(
    "$",
  );
}

/** Check a password against a stored hash in constant time; false for malformed hashes. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (!N || !r || !p || N > 2 ** 20 || r > 32 || p > 16) return false;
  const salt = Buffer.from(parts[4] as string, "base64");
  const expected = Buffer.from(parts[5] as string, "base64");
  if (expected.length !== KEY_LENGTH) return false;
  try {
    const key = await scryptAsync(password, salt, { N, r, p });
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/**
 * A random passphrase of five words from `PASSPHRASE_WORDS`, joined with dashes (about 49
 * bits; always longer than the 15-character minimum). Drawn again in the rare case the rules
 * refuse it.
 */
export function generatePassphrase(pick: (max: number) => number = randomInt): string {
  for (;;) {
    const words = Array.from(
      { length: 5 },
      () => PASSPHRASE_WORDS[pick(PASSPHRASE_WORDS.length)] as string,
    );
    const phrase = words.join("-");
    if (!passwordProblem(phrase)) return phrase;
  }
}
