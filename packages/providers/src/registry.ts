import type { ProviderInfo } from "@codeden/contracts";
import { type ProviderAdapter, providerInfo } from "./adapter";
import { ClaudeAdapter } from "./claude/adapter";
import { CodexAdapter } from "./codex/adapter";

/** The set of adapters a runner has loaded, keyed by id. */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>();

  constructor(adapters: ProviderAdapter[] = []) {
    for (const adapter of adapters) this.register(adapter);
  }

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Provider "${adapter.id}" is already registered`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }

  info(): ProviderInfo[] {
    return this.list().map(providerInfo);
  }
}

/** Fresh instances of the built-in real providers (Claude Code, Codex). */
export function builtinProviders(): ProviderAdapter[] {
  return [new ClaudeAdapter(), new CodexAdapter()];
}

let defaultRegistry: ProviderRegistry | undefined;

/** Process-wide registry of the built-in providers, created on first use. */
export function defaultProviderRegistry(): ProviderRegistry {
  defaultRegistry ??= new ProviderRegistry(builtinProviders());
  return defaultRegistry;
}

/** A built-in provider by id (`claude`, `codex`). */
export function getProvider(id: string): ProviderAdapter | undefined {
  return defaultProviderRegistry().get(id);
}

/** All built-in providers. Check `detect()` for which are installed and logged in. */
export function listProviders(): ProviderAdapter[] {
  return defaultProviderRegistry().list();
}
