import { resolve } from "node:path";
import { defineProject } from "vitest/config";

export default defineProject({
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  test: {
    environment: "jsdom",
    setupFiles: ["./test/setup.ts"],
  },
});
