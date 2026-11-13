import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:4322",
    trace: "retain-on-failure"
  },
  projects: [
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile-chromium", use: { ...devices["iPhone 13"], browserName: "chromium" } }
  ],
  webServer: process.env.E2E_FULLSTACK === "true" ? [
    {
      command: "node ../backend/dist/src/server.js",
      stdout: "pipe", stderr: "pipe",
      url: "http://127.0.0.1:8082/api/ready",
      reuseExistingServer: false, timeout: 60_000
    },
    {
      command: "node scripts/test-static-server.mjs",
      stdout: "pipe", stderr: "pipe",
      url: "http://127.0.0.1:4322",
      reuseExistingServer: false, timeout: 60_000
    }
  ] : {
    command: "node scripts/test-static-server.mjs",
    stdout: "pipe",
    stderr: "pipe",
    url: "http://127.0.0.1:4322",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
});
