import { UserRole } from "@prisma/client";
import prisma from "../../src/prismaClient";
import {
  createAuthenticatedRequest,
  createProduct,
  createSupplier,
  describeIfDatabase,
  useIntegrationDatabase,
} from "./helpers";

describeIfDatabase("Inventory routes", () => {
  useIntegrationDatabase();

  it("creates purchase inventory entries and updates stock", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const supplier = await createSupplier();
    const product = await createProduct({ name: "Inventory Stone", stockQty: 2 });

    const res = await manager.request
      .post("/inventory")
      .set("Cookie", manager.cookie)
      .send({
        type: "PURCHASE",
        inventoryNo: "P1",
        supplierId: supplier.id,
        productId: product.id,
        quantity: 5,
        unitCost: 10,
        isPaid: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.inventoryNo).toBe("P1");

    const refreshedProduct = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    });
    expect(refreshedProduct.stockQty).toBe(7);
  });

  it("rejects out-of-sequence inventory numbers", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const supplier = await createSupplier();
    const product = await createProduct();

    const first = await manager.request
      .post("/inventory")
      .set("Cookie", manager.cookie)
      .send({
        type: "PURCHASE",
        inventoryNo: "P1",
        supplierId: supplier.id,
        productId: product.id,
        quantity: 1,
        unitCost: 5,
      });

    expect(first.status).toBe(201);

    const duplicate = await manager.request
      .post("/inventory")
      .set("Cookie", manager.cookie)
      .send({
        type: "PURCHASE",
        inventoryNo: "P1",
        supplierId: supplier.id,
        productId: product.id,
        quantity: 2,
        unitCost: 5,
      });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({
      expectedNext: "P2",
    });
  });

  it("reverts stock when an inventory entry is deleted", async () => {
    const admin = await createAuthenticatedRequest({ role: UserRole.ADMIN });
    const supplier = await createSupplier();
    const product = await createProduct({ stockQty: 10 });

    const created = await admin.request
      .post("/inventory")
      .set("Cookie", admin.cookie)
      .send({
        type: "PURCHASE",
        inventoryNo: "P1",
        supplierId: supplier.id,
        productId: product.id,
        quantity: 3,
        unitCost: 12,
      });

    expect(created.status).toBe(201);

    const deleted = await admin.request
      .delete(`/inventory/${created.body.id}`)
      .set("Cookie", admin.cookie);

    expect(deleted.status).toBe(200);

    const refreshedProduct = await prisma.product.findUniqueOrThrow({
      where: { id: product.id },
    });
    expect(refreshedProduct.stockQty).toBe(10);
  });
});
