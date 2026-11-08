/** Names of CodeDen-internal variables that must never reach agents, shells or setup scripts. */
const SECRET = /^CODEDEN_.*(TOKEN|SECRET|KEY|PASSWORD)/i;

/**
 * Set when the desktop app runs CodeDen's own processes on its Electron binary (§17). It must
 * not reach the user's shells and agents: an Electron app started there would run as Node.js.
 */
const RUNTIME_ONLY = new Set(["ELECTRON_RUN_AS_NODE"]);

/**
 * Environment for child processes (§15): the user's environment minus CodeDen's own
 * secrets. `CODEDEN_HOME` and similar non-secret variables are kept.
 */
export function childEnv(extra: Record<string, string> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || SECRET.test(key) || RUNTIME_ONLY.has(key)) continue;
    out[key] = value;
  }
  return { ...out, ...extra };
}
