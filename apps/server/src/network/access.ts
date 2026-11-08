import { appendFileSync } from "node:fs";
import type { NetworkAddress, NetworkStatus } from "@codeden/contracts";
import { type InterfaceMap, listAddresses } from "./addresses";
import type { BindHost, HttpListener } from "./listener";
import { generatePassphrase } from "./password";
import { SignInLimiter } from "./rate-limit";
import type { RemoteAccessStore } from "./store";

/** Interface addresses are re-read at most this often (Host/Origin checks run per request). */
const ADDRESS_CACHE_MS = 5_000;

export interface NetworkAccessOptions {
  store: RemoteAccessStore;
  listener: HttpListener;
  /** Network interfaces; injectable for tests. */
  interfaces?: () => InterfaceMap;
  /** Clock for the sign-in limiter. */
  now?: () => number;
  /** Failed sign-ins are appended here (never the password). */
  securityLogFile?: string;
  log?: (message: string) => void;
}

/**
 * Network access (§15.1): owns the switch, the password, remote sessions, the sign-in limiter
 * and where the HTTP listener is bound. Turning access on moves the listener to `0.0.0.0`
 * (same port); off moves it back to `127.0.0.1` and drops remote connections. The runner is
 * never involved.
 */
export class NetworkAccess {
  readonly store: RemoteAccessStore;
  readonly limiter: SignInLimiter;
  private readonly listener: HttpListener;
  private readonly interfaces: () => InterfaceMap | undefined;
  private readonly log: (message: string) => void;
  private cached: { at: number; port: number; addresses: NetworkAddress[] } | undefined;

  constructor(private readonly opts: NetworkAccessOptions) {
    this.store = opts.store;
    this.listener = opts.listener;
    this.interfaces = opts.interfaces ?? (() => undefined);
    this.limiter = new SignInLimiter(opts.now);
    this.log = opts.log ?? (() => {});
  }

  /** On only when switched on *and* a password is set: never bind beyond loopback without one. */
  get enabled(): boolean {
    return this.store.enabled && this.store.passwordSet;
  }

  /** Where the listener should be bound for the stored settings. */
  desiredHost(): BindHost {
    return this.enabled ? "0.0.0.0" : "127.0.0.1";
  }

  get port(): number {
    return this.listener.port;
  }

  /** Every address the server would answer on (localhost first), cached briefly. */
  candidates(): NetworkAddress[] {
    const now = Date.now();
    const port = this.listener.port;
    if (!this.cached || this.cached.port !== port || now - this.cached.at > ADDRESS_CACHE_MS) {
      this.cached = { at: now, port, addresses: listAddresses(port, this.interfaces()) };
    }
    return this.cached.addresses;
  }

  /** Addresses it answers on now: localhost only while off. */
  addresses(): NetworkAddress[] {
    const all = this.candidates();
    return this.listener.host === "0.0.0.0" ? all : all.filter((a) => a.kind === "local");
  }

  /** The machine's own LAN/VPN hosts accepted in `Host` and `Origin` while access is on. */
  ownHosts(): ReadonlySet<string> {
    if (!this.enabled || this.listener.host !== "0.0.0.0") return new Set();
    return new Set(
      this.candidates()
        .filter((a) => a.kind !== "local")
        .map((a) => a.host),
    );
  }

  status(caller: { remote: boolean; sessionId?: string | null }): NetworkStatus {
    return {
      enabled: this.enabled,
      passwordSet: this.store.passwordSet,
      passwordSetAt: this.store.passwordSetAt,
      listening: this.listener.host === "0.0.0.0" ? "network" : "loopback",
      port: this.listener.port,
      addresses: this.addresses(),
      candidates: this.candidates(),
      devices: this.store.liveSessions().map((s) => ({
        id: s.id,
        label: s.label,
        address: s.address,
        createdAt: s.createdAt,
        lastSeenAt: s.lastSeenAt,
        expiresAt: s.expiresAt,
        current: s.id === caller.sessionId,
      })),
      remote: caller.remote,
    };
  }

  /** Turn network access on (needs a password) or off, and move the listener to match. */
  async setEnabled(enabled: boolean): Promise<void> {
    this.store.setEnabled(enabled);
    await this.applyBinding();
  }

  /** Bind the listener where the stored settings say; drops remote connections when off. */
  async applyBinding(): Promise<void> {
    const host = this.desiredHost();
    await this.listener.rebind(host);
    this.cached = undefined;
    if (host === "127.0.0.1") this.listener.dropRemote();
    this.log(
      host === "0.0.0.0"
        ? `network access on: ${this.addresses()
            .map((a) => a.url)
            .join(", ")}`
        : "network access off: listening on 127.0.0.1 only",
    );
  }

  /** Set (or generate) the password; signs out every remote device. Returns a generated one. */
  async setPassword(input: { password: string } | { generate: true }): Promise<string | null> {
    const generated = "generate" in input ? generatePassphrase() : null;
    await this.store.setPassword(generated ?? (input as { password: string }).password);
    this.listener.dropRemote();
    this.log("network access password changed: every remote device was signed out");
    return generated;
  }

  /** Sign out one device (and close remote connections so it notices). */
  revoke(id: string): boolean {
    const revoked = this.store.revoke(id);
    if (revoked) this.listener.dropRemote();
    return revoked;
  }

  revokeAll(): void {
    this.store.revokeAll();
    this.listener.dropRemote();
  }

  /** Note a failed sign-in with its address (the password is never logged). */
  recordFailedSignIn(address: string, reason: string): void {
    const line = `${new Date().toISOString()} failed sign-in from ${address || "unknown"}: ${reason}`;
    this.log(`network: ${line}`);
    if (this.opts.securityLogFile) {
      try {
        appendFileSync(this.opts.securityLogFile, `${line}\n`, { mode: 0o600 });
      } catch {
        // Logging must never break sign-in handling.
      }
    }
  }
}
