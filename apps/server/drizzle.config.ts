import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: [
    "./src/db/schema.ts",
    "./src/db/schema-orchestration.ts",
    "./src/db/schema-automations.ts",
  ],
  out: "./drizzle",
});
