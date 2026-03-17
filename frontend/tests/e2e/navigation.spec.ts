import { test, expect } from "@playwright/test";

const navChecks: Array<{ label: RegExp; heading: RegExp }> = [
  { label: /dashboard/i, heading: /dashboard/i },
  { label: /reports/i, heading: /reports/i },
  { label: /daily report/i, heading: /daily report/i },
  { label: /invoices/i, heading: /invoice/i },
  { label: /receipts/i, heading: /receipts/i },
  { label: /inventory/i, heading: /inventory/i },
  { label: /customers/i, heading: /customers/i },
  { label: /suppliers/i, heading: /suppliers/i },
  { label: /job sites/i, heading: /job sites/i },
  { label: /products/i, heading: /product/i },
  { label: /employees/i, heading: /employees/i },
  { label: /payroll/i, heading: /payroll/i },
  { label: /payments/i, heading: /payments/i },
  { label: /finance/i, heading: /finance/i },
  { label: /fleet/i, heading: /fleet/i },
  { label: /tools/i, heading: /tools/i },
  { label: /diesel/i, heading: /diesel/i },
  { label: /debris/i, heading: /debris/i },
  { label: /tehmil/i, heading: /tehmil/i },
  { label: /tax/i, heading: /tax/i },
  { label: /user access/i, heading: /manage users/i },
  { label: /debug/i, heading: /debug/i },
];

test.describe("Navigation", () => {
  test("renders the shell and sign out action", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "N.A.T" })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible();
  });

  test("visible nav links lead to their modules", async ({ page }) => {
    await page.goto("/");

    let executed = 0;
    for (const check of navChecks) {
      const link = page.getByRole("link", { name: check.label });
      if ((await link.count()) === 0) {
        continue;
      }

      await link.first().click();
      await expect(page.getByRole("heading", { name: check.heading }).first()).toBeVisible();
      executed += 1;
      if (executed >= 6) {
        break;
      }
    }

    expect(executed).toBeGreaterThan(0);
  });
});
