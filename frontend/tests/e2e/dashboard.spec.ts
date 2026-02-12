import { test, expect } from "@playwright/test";

test.describe("Dashboard", () => {
  test("renders core sections", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /quick actions/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /view advanced reports/i })).toBeVisible();
  });

  test("supports mobile navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const openMenu = page.getByLabel("Open menu");
    await expect(openMenu).toBeVisible();
    await openMenu.click();

    await expect(page.getByLabel("Close menu")).toBeVisible();
    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
  });
});
