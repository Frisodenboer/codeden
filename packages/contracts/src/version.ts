/**
 * CodeDen release version. Kept in sync with `apps/cli/package.json` (a test enforces it).
 * Server and runner exchange it during the runner handshake to detect upgrades.
 */
export const CODEDEN_VERSION = "0.1.0";

/** Version of the server <-> runner WebSocket protocol (§4.3). Bump on breaking changes. */
export const RUNNER_PROTOCOL_VERSION = 1;

/** Version of the server <-> UI WebSocket protocol. Bump on breaking changes. */
export const UI_PROTOCOL_VERSION = 1;
