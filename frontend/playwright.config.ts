import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.FRONTEND_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: true,
  workers: process.env.CI ? 2 : undefined,
  use: {
    baseURL,
    trace: "on-first-retry",
    storageState: "playwright/.auth/storageState.json",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "webkit",
      use: { ...devices["Desktop Safari"] },
    },
  ],
  globalSetup: "./tests/e2e/global-setup.ts",
  reporter: process.env.CI ? "dot" : [["list"], ["html", { outputFolder: "playwright-report" }]],
});
