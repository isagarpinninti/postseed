import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  webServer: { command: "node scripts/serve.mjs", url: "http://127.0.0.1:4378", reuseExistingServer: false, timeout: 30_000 },
  use: { baseURL: "http://127.0.0.1:4378", ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", screenshot: "only-on-failure" },
});
