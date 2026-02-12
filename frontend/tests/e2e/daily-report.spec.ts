import { test, expect } from "@playwright/test";

test.describe("Daily report", () => {
  test("loads and downloads PDF", async ({ page }) => {
    await page.goto("/daily-report");
    await expect(page.getByRole("heading", { name: /daily report/i })).toBeVisible();

    // Ensure date input has a value
    const dateInput = page.getByLabel("Date", { exact: true });
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
    const size = (await download.createReadStream())?.readableLength ?? 0;
    expect(size).toBeGreaterThan(0);
  });
});
