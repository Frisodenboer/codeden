/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override the server origin (desktop shell, remote dev). */
  readonly VITE_CODEDEN_SERVER?: string;
  /** `1` runs the UI against the in-memory mock client, `0` against the real server. */
  readonly VITE_CODEDEN_MOCK?: string;
}
