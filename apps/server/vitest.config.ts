import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Server tests never load the real Claude/Codex adapters in the runner they spawn, so no
    // test can reach a live agent or the utility model. Live tests opt in explicitly.
    env: { CODEDEN_BUILTIN_PROVIDERS: "0" },
  },
});
