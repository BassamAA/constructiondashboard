import { expect, request as playwrightRequest, test } from "@playwright/test";

const backendURL = process.env.BACKEND_URL || process.env.VITE_API_BASE || "http://localhost:4000";
const adminStorageState = "playwright/.auth/storageState.json";

async function createAdminApi() {
  return playwrightRequest.newContext({
    baseURL: backendURL,
    storageState: adminStorageState,
    extraHTTPHeaders: {
      "Content-Type": "application/json",
    },
  });
}

async function createUser(payload: {
  role: "MANAGER" | "WORKER";
  permissions?: Record<string, boolean>;
}) {
  const api = await createAdminApi();
  const stamp = Date.now();
  const password = "Password123!";
  const email = `e2e-${payload.role.toLowerCase()}-${stamp}@example.com`;

  const res = await api.post("/auth/users", {
    data: {
      email,
      password,
      role: payload.role,
      name: `E2E ${payload.role}`,
      permissions: payload.permissions,
    },
  });

  expect(res.ok()).toBeTruthy();
  await api.dispose();

  return { email, password };
}

async function login(page: import("@playwright/test").Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith("/login")),
    page.getByRole("button", { name: /sign in/i }).click(),
  ]);
}

test.describe("Permission-driven navigation", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("hides restricted manager modules when permissions are revoked", async ({ page }) => {
    const manager = await createUser({
      role: "MANAGER",
      permissions: {
        "payments:manage": false,
        "inventory:manage": false,
      },
    });

    await login(page, manager.email, manager.password);

    await expect(page.getByRole("link", { name: /dashboard/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /reports/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /payments/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /inventory/i })).toHaveCount(0);
  });

  test("limits worker navigation to worker-specific flows", async ({ page }) => {
    const worker = await createUser({ role: "WORKER" });

    await login(page, worker.email, worker.password);

    await expect(page.getByRole("link", { name: /create receipts/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /print receipts/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /dashboard/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /invoices/i })).toHaveCount(0);
  });
});
