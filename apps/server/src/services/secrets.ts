import type { SecretKey } from "@codeden/contracts";

/**
 * Secrets in the OS keychain (§6), e.g. an optional ElevenLabs key. Values never go to files,
 * logs or API responses.
 */
export interface SecretStore {
  readonly backend: "keyring" | "memory";
  get(key: SecretKey): Promise<string | null>;
  set(key: SecretKey, value: string): Promise<void>;
  delete(key: SecretKey): Promise<void>;
}

/** In-memory store for tests and machines without a usable keychain. */
export class MemorySecretStore implements SecretStore {
  readonly backend = "memory" as const;
  private readonly values = new Map<SecretKey, string>();

  async get(key: SecretKey): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async set(key: SecretKey, value: string): Promise<void> {
    this.values.set(key, value);
  }
  async delete(key: SecretKey): Promise<void> {
    this.values.delete(key);
  }
}

interface KeyringEntry {
  getPassword(): Promise<string | null>;
  setPassword(password: string): Promise<void>;
  deletePassword(): Promise<boolean>;
}
type EntryCtor = new (service: string, account: string) => KeyringEntry;

/** OS keychain through `@napi-rs/keyring` (Credential Manager, Keychain, Secret Service). */
export class KeyringSecretStore implements SecretStore {
  readonly backend = "keyring" as const;

  constructor(
    private readonly Entry: EntryCtor,
    private readonly service = "codeden",
  ) {}

  async get(key: SecretKey): Promise<string | null> {
    return new this.Entry(this.service, key).getPassword();
  }
  async set(key: SecretKey, value: string): Promise<void> {
    await new this.Entry(this.service, key).setPassword(value);
  }
  async delete(key: SecretKey): Promise<void> {
    await new this.Entry(this.service, key).deletePassword();
  }
}

/**
 * The OS keychain when the native module loads, else an in-memory store (secrets then last
 * only until the server stops). Loaded lazily so a missing prebuilt binary never blocks startup.
 */
export async function createSecretStore(log?: (m: string) => void): Promise<SecretStore> {
  try {
    const mod = (await import("@napi-rs/keyring")) as unknown as { AsyncEntry: EntryCtor };
    return new KeyringSecretStore(mod.AsyncEntry);
  } catch (error) {
    log?.(`keychain unavailable, keeping secrets in memory: ${String(error)}`);
    return new MemorySecretStore();
  }
}
