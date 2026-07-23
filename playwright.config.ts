import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  expect: { timeout: 10_000 },
  use: {
    baseURL: "http://127.0.0.1:5178",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "mobile-chromium",
      testMatch: /mobile\.spec\.ts/,
      use: { ...devices["Pixel 5"] }
    }
  ],
  webServer: [
    {
      command: "node e2e/start-e2e-api.mjs",
      url: "http://127.0.0.1:4000/api/health",
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: "VITE_API_PROXY_TARGET=http://127.0.0.1:4000 npm --prefix web run dev -- --host 127.0.0.1 --port 5178",
      url: "http://127.0.0.1:5178",
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
