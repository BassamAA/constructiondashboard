import request from "supertest";
import { UserRole } from "@prisma/client";
import prisma from "../../src/prismaClient";
import { app } from "../../src/app";
import {
  createAuthenticatedRequest,
  createCustomer,
  createProduct,
  createReceipt,
  describeIfDatabase,
  useIntegrationDatabase,
} from "./helpers";

describe("Receipts routes", () => {
  it("requires authentication for receipts list", async () => {
    const res = await request(app).get("/receipts");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "Authentication required" });
  });
});

describeIfDatabase("Receipt business logic", () => {
  useIntegrationDatabase();

  it("manager creates a receipt and gets an auto-assigned receipt number", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const product = await createProduct({ name: "Stone", stockQty: 100 });

    const res = await manager.request
      .post("/receipts")
      .set("Cookie", manager.cookie)
      .send({
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 2, unitPrice: 50 }],
      });

    expect(res.status).toBe(201);
    expect(Number(res.body.total)).toBe(100);
    expect(typeof res.body.receiptNo).toBe("string");
    expect(res.body.receiptNo.length).toBeGreaterThan(0);
    expect(res.body.customerId).toBe(customer.id);
  });

  it("applies 11% TVA to the receipt total for TVA type receipts", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer({ receiptType: "TVA" });
    const product = await createProduct({ name: "TVA Stone", stockQty: 100 });

    const res = await manager.request
      .post("/receipts")
      .set("Cookie", manager.cookie)
      .send({
        customerId: customer.id,
        type: "TVA",
        items: [{ productId: product.id, quantity: 1, unitPrice: 100 }],
      });

    expect(res.status).toBe(201);
    // 100 base × 1.11 = 111
    expect(Number(res.body.total)).toBeCloseTo(111, 1);
    expect(res.body.type).toBe("TVA");
  });

  it("rejects a duplicate receipt number and returns expectedNext hint", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const product = await createProduct({ stockQty: 100 });

    const first = await manager.request
      .post("/receipts")
      .set("Cookie", manager.cookie)
      .send({
        customerId: customer.id,
        receiptNo: "100",
        items: [{ productId: product.id, quantity: 1, unitPrice: 10 }],
      });

    expect(first.status).toBe(201);

    const duplicate = await manager.request
      .post("/receipts")
      .set("Cookie", manager.cookie)
      .send({
        customerId: customer.id,
        receiptNo: "100",
        items: [{ productId: product.id, quantity: 1, unitPrice: 10 }],
      });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toMatchObject({ expectedNext: "101" });
  });

  it("auto-increments the receipt number based on the last created receipt", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const product = await createProduct({ stockQty: 100 });

    await manager.request
      .post("/receipts")
      .set("Cookie", manager.cookie)
      .send({
        customerId: customer.id,
        receiptNo: "500",
        items: [{ productId: product.id, quantity: 1, unitPrice: 10 }],
      });

    const next = await manager.request
      .post("/receipts")
      .set("Cookie", manager.cookie)
      .send({
        customerId: customer.id,
        items: [{ productId: product.id, quantity: 1, unitPrice: 10 }],
      });

    expect(next.status).toBe(201);
    expect(next.body.receiptNo).toBe("501");
  });

  it("admin can delete a receipt and it is removed from the database", async () => {
    const admin = await createAuthenticatedRequest({ role: UserRole.ADMIN });
    const customer = await createCustomer();
    const receipt = await createReceipt({ customerId: customer.id, total: 80 });

    const res = await admin.request
      .delete(`/receipts/${receipt.id}`)
      .set("Cookie", admin.cookie);

    expect(res.status).toBe(200);

    const gone = await prisma.receipt.findUnique({ where: { id: receipt.id } });
    expect(gone).toBeNull();
  });

  it("blocks workers from creating receipts", async () => {
    const worker = await createAuthenticatedRequest({ role: UserRole.WORKER });
    const product = await createProduct({ stockQty: 10 });

    const res = await worker.request
      .post("/receipts")
      .set("Cookie", worker.cookie)
      .send({
        items: [{ productId: product.id, quantity: 1, unitPrice: 10 }],
      });

    expect(res.status).toBe(403);
  });

  it("returns 404 for a receipt that does not exist", async () => {
    const admin = await createAuthenticatedRequest({ role: UserRole.ADMIN });

    const res = await admin.request
      .get("/receipts/999999")
      .set("Cookie", admin.cookie);

    expect(res.status).toBe(404);
  });
});
