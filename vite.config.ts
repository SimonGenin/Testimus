import { readFileSync } from "node:fs";
import stylex from "@stylexjs/unplugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string };
const API = process.env.TESTIMUS_API_TARGET ?? "http://localhost:4317";

// ponytail: vitest has no page to refresh, and the plugin's dev server polls its CSS store on an interval that keeps
// vitest from exiting — under vitest it only compiles
function styles(dev: boolean) {
  const plugin = stylex.vite({
    dev,
    devMode: process.env.VITEST ? "css-only" : "full",
    unstable_moduleResolution: { type: "commonJS", rootDir: import.meta.dirname },
  });
  return process.env.VITEST ? { ...plugin, configureServer: undefined, transformIndexHtml: undefined } : plugin;
}

export default defineConfig(({ command }) => ({
  root: "src/ui",
  plugins: [styles(command === "serve"), react()],
  define: { __VERSION__: JSON.stringify(version) },
  build: { outDir: "../../dist/ui", emptyOutDir: true },
  server: {
    port: 4318,
    proxy: {
      "^/api(/|$)": { target: API, changeOrigin: true, headers: { origin: API } },
      "^/files/": { target: API, changeOrigin: true, headers: { origin: API } },
    },
  },
  test: {
    root: ".",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    environment: "node",
    globalSetup: ["./tests/unit/global-setup.ts"],
    setupFiles: ["./tests/unit/setup.ts"],
    testTimeout: 20000,
    // ponytail: the persistent module cache keeps an import.meta.glob's old file list (a new kit section went unseen)
    fsModuleCache: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      reporter: ["text-summary", "json-summary", "json", "html"],
      reportsDirectory: "coverage",
      reportOnFailure: true,
    },
  },
}));
