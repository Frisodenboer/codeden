/** Names of CodeDen-internal variables that must never reach agents, shells or setup scripts. */
const SECRET = /^CODEDEN_.*(TOKEN|SECRET|KEY|PASSWORD)/i;

/**
 * Environment for child processes (§15): the user's environment minus CodeDen's own
 * secrets. `CODEDEN_HOME` and similar non-secret variables are kept.
 */
export function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || SECRET.test(key)) continue;
    out[key] = value;
  }
  return { ...out, ...extra };
}
