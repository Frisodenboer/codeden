import type { BillingMode, SetupStatus } from "@codeden/contracts";

/**
 * How a login is paid for, from the auth method a CLI reports: API keys and console
 * accounts pay per token; claude.ai and ChatGPT logins are subscriptions. Pure.
 */
export function billingFromAuthMethod(authMethod: string | null): BillingMode {
  if (!authMethod) return "unknown";
  const m = authMethod.toLowerCase();
  if (/api[\s_-]?key|apikey|console|bedrock|vertex/.test(m)) return "api";
  if (/claude\.ai|chatgpt|oauth|subscription|\bpro\b|\bmax\b|team|enterprise/.test(m)) {
    return "subscription";
  }
  return "unknown";
}

/** Billing mode per provider id from setup detection (`claude`, `codex`). */
export function billingFromSetup(status: SetupStatus): Record<string, BillingMode> {
  const out: Record<string, BillingMode> = {};
  for (const check of status.checks) {
    if (check.id === "claude" || check.id === "codex") {
      out[check.id] = check.loggedIn ? billingFromAuthMethod(check.authMethod) : "unknown";
    }
  }
  return out;
}
