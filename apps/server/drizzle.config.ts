import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  // Every table file; `src/db/schema.ts` is only a barrel over these (listing it would duplicate).
  schema: "./src/db/schema-*.ts",
  out: "./drizzle",
});
