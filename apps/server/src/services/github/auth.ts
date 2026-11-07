import type { GithubTokenSource } from "@codeden/contracts";
import type { Exec } from "../exec";
import type { SecretStore } from "../secrets";

/** A resolved token. Never logged, persisted or returned by an API. */
export interface GithubToken {
  value: string;
  source: GithubTokenSource;
}

export interface GithubAuthDeps {
  exec: Exec;
  secrets: SecretStore;
  /** How long a missing token is remembered before `gh` is asked again (default 30 s). */
  missRetryMs?: number;
  now?: () => number;
}

/**
 * The GitHub token (§9, §14): `gh auth token` read at runtime, else a token the user stored in
 * the OS keychain (`github.token`). Cached in memory; `invalidate()` after a 401 makes the next
 * call ask again, so a re-login with `gh` is picked up without a restart.
 */
export class GithubAuth {
  private cached: GithubToken | null = null;
  private missAt = 0;
  private pending: Promise<GithubToken | null> | null = null;
  private reason: string | null = null;

  constructor(private readonly deps: GithubAuthDeps) {}

  /** The current token, or null when GitHub is not connected. */
  async token(): Promise<GithubToken | null> {
    if (this.cached) return this.cached;
    const now = this.deps.now?.() ?? Date.now();
    if (this.missAt && now - this.missAt < (this.deps.missRetryMs ?? 30_000)) return null;
    this.pending ??= this.resolve().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  /** Forget the cached token (after a 401); `rejected` is the token that failed. */
  invalidate(rejected?: GithubToken): void {
    if (!rejected || this.cached?.value === rejected.value) this.cached = null;
    this.missAt = 0;
  }

  /** Why the last lookup found no token, for the "not connected" state. */
  lastReason(): string | null {
    return this.reason;
  }

  private async resolve(): Promise<GithubToken | null> {
    const fromGh = await this.fromGh();
    const token = fromGh ?? (await this.fromKeychain());
    if (token) {
      this.cached = token;
      this.missAt = 0;
      this.reason = null;
    } else {
      this.missAt = this.deps.now?.() ?? Date.now();
    }
    return token;
  }

  private async fromGh(): Promise<GithubToken | null> {
    try {
      const result = await this.deps.exec("gh", ["auth", "token", "--hostname", "github.com"], {
        timeoutMs: 10_000,
        maxOutput: 16 * 1024,
      });
      if (result.notFound) {
        this.reason = "The GitHub CLI (gh) is not installed. Install it and run `gh auth login`.";
        return null;
      }
      const value = result.stdout.trim();
      if (result.code === 0 && /^\S+$/.test(value)) return { value, source: "gh" };
      this.reason = "GitHub CLI is not logged in. Run `gh auth login`.";
      return null;
    } catch {
      this.reason = "Could not run the GitHub CLI.";
      return null;
    }
  }

  private async fromKeychain(): Promise<GithubToken | null> {
    try {
      const value = (await this.deps.secrets.get("github.token"))?.trim();
      return value ? { value, source: "keychain" } : null;
    } catch {
      return null;
    }
  }
}
