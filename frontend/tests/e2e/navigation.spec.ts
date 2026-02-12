import { test, expect } from "@playwright/test";

const navChecks: Array<{ label: string; heading: RegExp }> = [
  { label: "Dashboard", heading: /dashboard/i },
  { label: "Reports", heading: /reports/i },
  { label: "Daily report", heading: /daily report/i },
  { label: "Invoices", heading: /invoice/i },
  { label: "Receipts", heading: /receipts/i },
  { label: "Inventory", heading: /inventory/i },
  { label: "Customers", heading: /customers/i },
  { label: "Suppliers", heading: /suppliers/i },
  { label: "Job Sites", heading: /job sites/i },
  { label: "Products", heading: /product/i },
  { label: "Employees", heading: /employees/i },
  { label: "Payroll", heading: /payroll/i },
  { label: "Payments", heading: /payments/i },
  { label: "Finance", heading: /finance/i },
  { label: "Fleet", heading: /fleet/i },
  { label: "Tools", heading: /tools/i },
  { label: "Diesel", heading: /diesel/i },
  { label: "Debris", heading: /debris/i },
  { label: "Tehmil & Tenzil", heading: /tehmil/i },
  { label: "Tax", heading: /tax/i },
  { label: "User access", heading: /manage users/i },
  { label: "Debug", heading: /debug/i },
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
      const link = page.getByRole("link", { name: check.label, exact: true });
      if ((await link.count()) === 0) {
        continue;
      }

      await link.first().click();
      await expect(page.getByRole("heading", { name: check.heading })).toBeVisible();
      executed += 1;
      if (executed >= 6) {
        break;
      }
    }

    expect(executed).toBeGreaterThan(0);
  });
});
