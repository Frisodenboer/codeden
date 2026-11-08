import type { AutonomyLevel, ProviderInfo, Role } from "@codeden/contracts";

/**
 * Why a session cannot use a permission level on a provider, or null when it can. The
 * `read_only` level needs a provider that enforces it natively (`capabilities.readOnly`,
 * §11.2); read-only roles (orchestrator, PMs) are read-only on every provider. An unknown
 * provider (the runner is not connected yet) is let through: the provider refuses at start.
 */
export function readOnlyUnsupported(
  role: Role,
  level: AutonomyLevel,
  provider: ProviderInfo | undefined,
): string | null {
  if (level !== "read_only" || role !== "agent" || !provider) return null;
  if (provider.capabilities.readOnly) return null;
  return `${provider.displayName} cannot run sessions with read-only permissions`;
}
