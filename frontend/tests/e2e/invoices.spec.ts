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

async function seedInvoiceScenario() {
  const api = await createAdminApi();
  const stamp = Date.now();

  const customerRes = await api.post("/customers", {
    data: { name: `E2E Customer ${stamp}`, receiptType: "NORMAL" },
  });
  expect(customerRes.ok()).toBeTruthy();
  const customer = await customerRes.json();

  const productRes = await api.post("/products", {
    data: { name: `E2E Product ${stamp}`, unit: "ton", unitPrice: 125 },
  });
  expect(productRes.ok()).toBeTruthy();
  const product = await productRes.json();

  const receiptRes = await api.post("/receipts", {
    data: {
      customerId: customer.id,
      items: [{ productId: product.id, quantity: 1, unitPrice: 125 }],
    },
  });
  expect(receiptRes.ok()).toBeTruthy();
  const receipt = await receiptRes.json();

  await api.dispose();
  return { customer, receipt };
}

test.describe("Invoice workflow", () => {
  test("creates and marks an invoice paid through the UI", async ({ page }) => {
    const { customer, receipt } = await seedInvoiceScenario();

    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: /invoice builder/i })).toBeVisible();

    await page.getByLabel(/customer/i).selectOption(String(customer.id));
    await expect(page.getByText(new RegExp(`Receipts for ${customer.name}`))).toBeVisible();

    await page.getByRole("button", { name: /select all/i }).click();
    await page.getByRole("button", { name: /preview invoice/i }).click();

    await expect(page.getByRole("heading", { name: /invoice preview/i })).toBeVisible();
    await expect(page.getByRole("cell", { name: receipt.receiptNo }).first()).toBeVisible();

    await page.getByRole("button", { name: /save invoice/i }).click();

    await expect(page.getByText(new RegExp(`Invoice .* saved`, "i")).first()).toBeVisible();
    const savedInvoiceRow = page.getByRole("row", { name: new RegExp(customer.name) }).last();
    await expect(savedInvoiceRow).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await savedInvoiceRow.getByRole("button", { name: /^mark paid$/i }).click();
    await expect(savedInvoiceRow.getByRole("cell", { name: /^PAID$/i })).toBeVisible();
    await expect(page.getByText(/^Status:\s*PAID$/i)).toBeVisible();
  });
});
