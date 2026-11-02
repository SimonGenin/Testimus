import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const API = process.env.TESTIMUS_API_TARGET ?? "http://localhost:4317";

export default defineConfig({
  root: "src/ui",
  plugins: [react()],
  define: { __VERSION__: JSON.stringify(version) },
  build: { outDir: "../../dist/ui", emptyOutDir: true },
  server: {
    port: 4318,
    proxy: {
      "/api": { target: API, changeOrigin: true, headers: { origin: API } },
      "/files": { target: API, changeOrigin: true, headers: { origin: API } },
    },
  },
  test: {
    root: ".",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
    setupFiles: ["./tests/unit/setup.ts"],
    testTimeout: 20000,
  },
});
