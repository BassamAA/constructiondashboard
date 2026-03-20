import { UserRole } from "@prisma/client";
import prisma from "../../src/prismaClient";
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

describeIfDatabase("Payment routes", () => {
  useIntegrationDatabase();

  it("applies customer payments to outstanding receipts", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const older = await createReceipt({
      customerId: customer.id,
      total: 100,
      amountPaid: 0,
      isPaid: false,
      receiptNo: "R-PAY-1",
    });
    const newer = await createReceipt({
      customerId: customer.id,
      total: 80,
      amountPaid: 0,
      isPaid: false,
      receiptNo: "R-PAY-2",
    });

    const res = await manager.request
      .post("/payments")
      .set("Cookie", manager.cookie)
      .send({
        type: "CUSTOMER_PAYMENT",
        customerId: customer.id,
        amount: 130,
      });

    expect(res.status).toBe(201);
    expect(res.body.type).toBe("CUSTOMER_PAYMENT");

    const refreshedOlder = await prisma.receipt.findUniqueOrThrow({ where: { id: older.id } });
    const refreshedNewer = await prisma.receipt.findUniqueOrThrow({ where: { id: newer.id } });

    expect(refreshedOlder.amountPaid).toBe(100);
    expect(refreshedOlder.isPaid).toBe(true);
    expect(refreshedNewer.amountPaid).toBe(30);
    expect(refreshedNewer.isPaid).toBe(false);
  });

  it("applies supplier payments to outstanding purchases", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const supplier = await createSupplier();
    const product = await createProduct({ name: "Supplier Stone" });
    const purchase = await createInventoryPurchase({
      supplierId: supplier.id,
      productId: product.id,
      inventoryNo: "P-100",
      quantity: 4,
      unitCost: 25,
      isPaid: false,
      amountPaid: 0,
    });

    const res = await manager.request
      .post("/payments")
      .set("Cookie", manager.cookie)
      .send({
        type: "SUPPLIER",
        supplierId: supplier.id,
        amount: 100,
      });

    expect(res.status).toBe(201);

    const refreshed = await prisma.inventoryEntry.findUniqueOrThrow({
      where: { id: purchase.id },
    });

    expect(refreshed.amountPaid).toBe(100);
    expect(refreshed.isPaid).toBe(true);

    const links = await prisma.inventoryPayment.findMany({
      where: { inventoryEntryId: purchase.id },
    });
    expect(links).toHaveLength(1);
    expect(links[0].amount).toBe(100);
  });

  it("validates missing supplier id for supplier payments", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });

    const res = await manager.request
      .post("/payments")
      .set("Cookie", manager.cookie)
      .send({
        type: "SUPPLIER",
        amount: 20,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "supplierId is required for supplier payments",
    });
  });

  it("rejects a payment with zero amount", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();

    const res = await manager.request
      .post("/payments")
      .set("Cookie", manager.cookie)
      .send({
        type: "CUSTOMER_PAYMENT",
        customerId: customer.id,
        amount: 0,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "amount must be a positive number" });
  });

  it("rejects a customer payment without customerId", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });

    const res = await manager.request
      .post("/payments")
      .set("Cookie", manager.cookie)
      .send({
        type: "CUSTOMER_PAYMENT",
        amount: 50,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      error: "customerId is required for customer payments",
    });
  });

  it("deleting a payment reverts the applied amount on linked receipts", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const receipt = await createReceipt({
      customerId: customer.id,
      total: 80,
      amountPaid: 0,
      isPaid: false,
      receiptNo: "R-DEL-REVERT",
    });

    const created = await manager.request
      .post("/payments")
      .set("Cookie", manager.cookie)
      .send({
        type: "CUSTOMER_PAYMENT",
        customerId: customer.id,
        amount: 80,
      });

    expect(created.status).toBe(201);

    const afterPayment = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(afterPayment.isPaid).toBe(true);
    expect(Number(afterPayment.amountPaid)).toBe(80);

    const deleted = await manager.request
      .delete(`/payments/${created.body.id}`)
      .set("Cookie", manager.cookie);

    expect(deleted.status).toBe(204);

    const afterDelete = await prisma.receipt.findUniqueOrThrow({ where: { id: receipt.id } });
    expect(Number(afterDelete.amountPaid)).toBe(0);
    expect(afterDelete.isPaid).toBe(false);
  });
});
