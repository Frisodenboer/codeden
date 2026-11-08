import type { ModelInfo } from "@codeden/contracts";

function copy(m: ModelInfo): ModelInfo {
  return { ...m, efforts: [...m.efforts] };
}

/**
 * An adapter's current model list. It starts from a fallback and is replaced by what the
 * provider reports (model discovery, a running session). Listeners hear about real changes
 * only, so the runner can forward them to the server (§4.3).
 */
export class ModelCatalog {
  private models: ModelInfo[];
  private readonly listeners = new Set<() => void>();

  constructor(fallback: ModelInfo[]) {
    this.models = fallback.map(copy);
  }

  /** A copy of the current list. */
  list(): ModelInfo[] {
    return this.models.map(copy);
  }

  /** Replace the list. Returns false (and notifies nobody) when nothing changed. */
  set(models: ModelInfo[]): boolean {
    if (JSON.stringify(models) === JSON.stringify(this.models)) return false;
    this.models = models.map(copy);
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A failing listener must not stop the others or the caller.
      }
    }
    return true;
  }

  /** Call `listener` after every change. Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
