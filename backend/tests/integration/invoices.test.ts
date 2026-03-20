import { UserRole } from "@prisma/client";
import prisma from "../../src/prismaClient";
import {
  createAuthenticatedRequest,
  createCustomer,
  createReceipt,
  describeIfDatabase,
  useIntegrationDatabase,
} from "./helpers";

describeIfDatabase("Invoice routes", () => {
  useIntegrationDatabase();

  it("creates an invoice from unpaid receipts", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const receiptOne = await createReceipt({
      customerId: customer.id,
      total: 100,
      receiptNo: "R-INV-1",
    });
    const receiptTwo = await createReceipt({
      customerId: customer.id,
      total: 50,
      receiptNo: "R-INV-2",
    });

    const res = await manager.request
      .post("/invoices")
      .set("Cookie", manager.cookie)
      .send({
        customerId: customer.id,
        receiptIds: [receiptOne.id, receiptTwo.id],
        notes: "Batch invoice",
      });

    expect(res.status).toBe(201);
    expect(res.body.invoice.receiptCount).toBe(2);
    expect(res.body.invoice.subtotal).toBe(150);
    expect(res.body.status).toBe("PENDING");
  });

  it("rejects mixed receipt types", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const normal = await createReceipt({ customerId: customer.id, total: 90, type: "NORMAL" });
    const tva = await createReceipt({ customerId: customer.id, total: 110, type: "TVA" });

    const res = await manager.request
      .post("/invoices")
      .set("Cookie", manager.cookie)
      .send({
        customerId: customer.id,
        receiptIds: [normal.id, tva.id],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot mix normal and tva/i);
  });

  it("marks an invoice paid and propagates payment to linked receipts", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const receipt = await createReceipt({
      customerId: customer.id,
      total: 140,
      amountPaid: 0,
      isPaid: false,
      receiptNo: "R-MARK-PAID",
    });

    const created = await manager.request
      .post("/invoices")
      .set("Cookie", manager.cookie)
      .send({
        customerId: customer.id,
        receiptIds: [receipt.id],
      });

    expect(created.status).toBe(201);

    const paid = await manager.request
      .post(`/invoices/${created.body.id}/mark-paid`)
      .set("Cookie", manager.cookie)
      .send({});

    expect(paid.status).toBe(200);
    expect(paid.body.status).toBe("PAID");
    expect(paid.body.invoice.outstanding).toBe(0);

    const refreshedReceipt = await prisma.receipt.findUniqueOrThrow({
      where: { id: receipt.id },
    });
    expect(refreshedReceipt.amountPaid).toBe(140);
    expect(refreshedReceipt.isPaid).toBe(true);

    const payment = await prisma.payment.findFirst({
      where: { customerId: customer.id, description: { contains: "Invoice" } },
    });
    expect(payment).not.toBeNull();
  });

  it("lists invoices and supports filtering by status", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const receipt = await createReceipt({ customerId: customer.id, total: 60, receiptNo: "R-LIST-1" });

    await manager.request
      .post("/invoices")
      .set("Cookie", manager.cookie)
      .send({ customerId: customer.id, receiptIds: [receipt.id] });

    const res = await manager.request
      .get("/invoices?status=PENDING")
      .set("Cookie", manager.cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].status).toBe("PENDING");
    expect(res.body[0]).toHaveProperty("id");
    expect(res.body[0]).toHaveProperty("invoice");
  });

  it("fetches a single invoice by id", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const receipt = await createReceipt({ customerId: customer.id, total: 75, receiptNo: "R-GET-1" });

    const created = await manager.request
      .post("/invoices")
      .set("Cookie", manager.cookie)
      .send({ customerId: customer.id, receiptIds: [receipt.id] });

    expect(created.status).toBe(201);

    const res = await manager.request
      .get(`/invoices/${created.body.id}`)
      .set("Cookie", manager.cookie);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(created.body.id);
    expect(res.body.invoice.receiptCount).toBe(1);
    expect(res.body.invoice.subtotal).toBe(75);
  });

  it("returns 404 when fetching a nonexistent invoice", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });

    const res = await manager.request
      .get("/invoices/999999")
      .set("Cookie", manager.cookie);

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "Invoice not found" });
  });

  it("rejects invoicing a receipt that is already part of another invoice", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const receipt = await createReceipt({ customerId: customer.id, total: 90, receiptNo: "R-DUP-INV" });

    const first = await manager.request
      .post("/invoices")
      .set("Cookie", manager.cookie)
      .send({ customerId: customer.id, receiptIds: [receipt.id] });

    expect(first.status).toBe(201);

    const second = await manager.request
      .post("/invoices")
      .set("Cookie", manager.cookie)
      .send({ customerId: customer.id, receiptIds: [receipt.id] });

    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/already been invoiced/i);
  });

  it("rejects marking an already-paid invoice as paid again", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const receipt = await createReceipt({ customerId: customer.id, total: 50, receiptNo: "R-DBLEPAY" });

    const created = await manager.request
      .post("/invoices")
      .set("Cookie", manager.cookie)
      .send({ customerId: customer.id, receiptIds: [receipt.id] });

    expect(created.status).toBe(201);

    const firstPay = await manager.request
      .post(`/invoices/${created.body.id}/mark-paid`)
      .set("Cookie", manager.cookie)
      .send({});

    expect(firstPay.status).toBe(200);

    const secondPay = await manager.request
      .post(`/invoices/${created.body.id}/mark-paid`)
      .set("Cookie", manager.cookie)
      .send({});

    expect(secondPay.status).toBe(400);
    expect(secondPay.body.error).toMatch(/already marked as paid/i);
  });

  it("only allows admins to delete invoices", async () => {
    const admin = await createAuthenticatedRequest({ role: UserRole.ADMIN });
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const receipt = await createReceipt({ customerId: customer.id, total: 75 });

    const created = await admin.request
      .post("/invoices")
      .set("Cookie", admin.cookie)
      .send({
        customerId: customer.id,
        receiptIds: [receipt.id],
      });

    expect(created.status).toBe(201);

    const forbidden = await manager.request
      .delete(`/invoices/${created.body.id}`)
      .set("Cookie", manager.cookie);

    expect(forbidden.status).toBe(403);

    const deleted = await admin.request
      .delete(`/invoices/${created.body.id}`)
      .set("Cookie", admin.cookie);

    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ message: "Invoice deleted" });
  });
});
