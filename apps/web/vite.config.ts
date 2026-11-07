import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const serverUrl = process.env.CODEDEN_SERVER_URL ?? "http://127.0.0.1:4317";
const devHome = process.env.CODEDEN_HOME ?? resolve(import.meta.dirname, "../../.codeden-dev");

/** Dev token written by the dev server; read per request so a fresh install just works. */
function devToken(): string {
  try {
    return readFileSync(resolve(devHome, "install-token"), "utf8").trim();
  } catch {
    return "";
  }
}

const withToken: ProxyOptions["configure"] = (proxy) => {
  proxy.on("proxyReq", (req) => req.setHeader("authorization", `Bearer ${devToken()}`));
  proxy.on("proxyReqWs", (req) => req.setHeader("authorization", `Bearer ${devToken()}`));
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: serverUrl, changeOrigin: true, configure: withToken },
      "/ws": { target: serverUrl, ws: true, changeOrigin: true, configure: withToken },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
});
