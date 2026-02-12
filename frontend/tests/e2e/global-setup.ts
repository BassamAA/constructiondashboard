import { chromium, type FullConfig } from "@playwright/test";

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const userEmail = process.env.E2E_EMAIL;
const userPassword = process.env.E2E_PASSWORD;

export default async function globalSetup(_config: FullConfig) {
  if (!userEmail || !userPassword) {
    throw new Error("Set E2E_EMAIL and E2E_PASSWORD env vars for Playwright login.");
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${frontendUrl}/login`);

  await page.getByLabel("Email").fill(userEmail);
  await page.getByLabel("Password").fill(userPassword);
  await Promise.all([page.waitForNavigation(), page.getByRole("button", { name: "Sign in" }).click()]);

  await page.context().storageState({ path: "playwright/.auth/storageState.json" });
  await browser.close();
}
