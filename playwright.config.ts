import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.TESTIMUS_E2E_PORT) || 4327;

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  use: {
    channel: "msedge",
    headless: true,
    baseURL: `http://localhost:${PORT}`,
    screenshot: "off",
    viewport: { width: 1440, height: 960 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npx vite build && node src/faces/cli.ts serve --mock --port ${PORT} --no-open`,
    url: `http://localhost:${PORT}/api/system/version`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
