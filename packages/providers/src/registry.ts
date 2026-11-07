import type { ProviderInfo } from "@codeden/contracts";
import { type ProviderAdapter, providerInfo } from "./adapter";

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
