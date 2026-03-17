import fs from "node:fs/promises";
import { test, expect } from "@playwright/test";

test.describe("Daily report", () => {
  test("@critical loads and downloads PDF", async ({ page }) => {
    await page.goto("/daily-report");
    await expect(page.getByRole("heading", { name: /daily report/i })).toBeVisible();

    const dateInput = page.getByLabel(/date/i);
    await expect(dateInput).toBeVisible();
    const current = await dateInput.inputValue();
    if (!current) {
      const today = new Date().toISOString().slice(0, 10);
      await dateInput.fill(today);
    }

    await page.getByRole("button", { name: /load report/i }).click();
    await expect(page.getByText(/receipts total/i)).toBeVisible({ timeout: 15000 });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: /download pdf/i }).click(),
    ]);
    const path = await download.path();
    expect(path).toBeTruthy();
    const stats = await fs.stat(path!);
    expect(stats.size).toBeGreaterThan(0);
  });
});
