import { chromium, expect, type FullConfig } from "@playwright/test";

const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
const backendUrl = process.env.BACKEND_URL || process.env.VITE_API_BASE || "http://localhost:4000";
const userEmail = process.env.E2E_EMAIL;
const userPassword = process.env.E2E_PASSWORD;
const bootstrapToken = process.env.E2E_BOOTSTRAP_TOKEN;
const bootstrapName = process.env.E2E_NAME || "Playwright Admin";

async function bootstrapAdminUser() {
  if (!bootstrapToken || !userEmail || !userPassword) {
    return;
  }

  const response = await fetch(`${backendUrl.replace(/\/$/, "")}/auth/bootstrap`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-bootstrap-token": bootstrapToken,
    },
    body: JSON.stringify({
      email: userEmail,
      password: userPassword,
      name: bootstrapName,
    }),
  });

  if (response.ok) {
    return;
  }

  const payload = await response.json().catch(() => ({}));
  if (response.status === 400 && payload?.error === "Users already exist. Use the normal login flow.") {
    return;
  }

  throw new Error(`Failed to bootstrap Playwright admin: ${response.status} ${JSON.stringify(payload)}`);
}

export default async function globalSetup(_config: FullConfig) {
  if (!userEmail || !userPassword) {
    throw new Error("Set E2E_EMAIL and E2E_PASSWORD env vars for Playwright login.");
  }

  await bootstrapAdminUser();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`${frontendUrl}/login`);

  await page.getByLabel("Email").fill(userEmail);
  await page.getByLabel("Password").fill(userPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect
    .poll(async () => new URL(page.url()).pathname, {
      timeout: 30000,
      message: "Expected Playwright global setup login to leave /login",
    })
    .not.toBe("/login");

  await page.context().storageState({ path: "playwright/.auth/storageState.json" });
  await browser.close();
}
