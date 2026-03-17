import { UserRole } from "@prisma/client";
import {
  createAuthenticatedRequest,
  createCustomer,
  createInventoryPurchase,
  createProduct,
  createReceipt,
  createSupplier,
  describeIfDatabase,
  useIntegrationDatabase,
} from "./helpers";

describeIfDatabase("Report routes", () => {
  useIntegrationDatabase();

  it("returns report summary aggregates for receipts and purchases", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const supplier = await createSupplier();
    const saleProduct = await createProduct({ name: "Sold Stone" });
    const purchaseProduct = await createProduct({ name: "Raw Material" });

    await createReceipt({
      customerId: customer.id,
      productId: saleProduct.id,
      total: 200,
      amountPaid: 50,
      isPaid: false,
    });

    await createInventoryPurchase({
      supplierId: supplier.id,
      productId: purchaseProduct.id,
      inventoryNo: "P1",
      quantity: 4,
      unitCost: 30,
      isPaid: false,
      amountPaid: 0,
    });

    const res = await manager.request
      .get("/reports/summary")
      .set("Cookie", manager.cookie);

    expect(res.status).toBe(200);
    expect(res.body.revenue.totalSales).toBe(200);
    expect(res.body.revenue.outstandingAmount).toBe(150);
    expect(res.body.purchases.totalPurchaseCost).toBe(120);
    expect(res.body.purchases.outstanding).toHaveLength(1);
    expect(res.body.receivables.customers.length).toBeGreaterThan(0);
  });
});
