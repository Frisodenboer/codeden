/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Override the server origin (desktop shell, remote dev). */
  readonly VITE_CODEDEN_SERVER?: string;
}
