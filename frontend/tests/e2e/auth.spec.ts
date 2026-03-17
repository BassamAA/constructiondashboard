import { test, expect } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./accessibility";

test.describe("Authentication", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("redirects unauthenticated users to login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
  });

  test("renders the login form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("has no serious accessibility violations on the login page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });
});
