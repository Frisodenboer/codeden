import type {
  DesktopHostMessage,
  DesktopServerMessage,
  DesktopUpdateCommand,
  DesktopUpdateState,
} from "@codeden/contracts";

/**
 * The server side of the desktop updater (§17): mirrors the main process's updater state and
 * runs commands there over IPC. Implements the server's `DesktopUpdater` seam.
 */
export class IpcDesktopUpdater {
  private current: DesktopUpdateState;
  private readonly listeners = new Set<(state: DesktopUpdateState) => void>();
  private readonly pending = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  private nextId = 0;

  constructor(
    private readonly send: (message: DesktopServerMessage) => void,
    version: string,
  ) {
    this.current = {
      phase: "idle",
      current: version,
      latest: null,
      checkedAt: null,
      percent: null,
      error: null,
      unsupported: null,
    };
  }

  state(): DesktopUpdateState {
    return this.current;
  }

  onChange(listener: (state: DesktopUpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  run(command: DesktopUpdateCommand): Promise<void> {
    const id = String(++this.nextId);
    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.send({ type: "update.command", id, command });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Apply a message from the main process; returns false for messages it does not handle. */
  handle(message: DesktopHostMessage): boolean {
    if (message.type === "update.state") {
      this.current = message.state;
      for (const listener of this.listeners) listener(message.state);
      return true;
    }
    if (message.type === "update.done") {
      const waiter = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error === null) waiter?.resolve();
      else waiter?.reject(new Error(message.error));
      return true;
    }
    return false;
  }
}
