import { UserRole } from "@prisma/client";
import prisma from "../../src/prismaClient";
import {
  createAuthenticatedRequest,
  createCustomer,
  createInventoryPurchase,
  createJobSite,
  createProduct,
  createReceipt,
  createSupplier,
  describeIfDatabase,
  useIntegrationDatabase,
} from "./helpers";

describeIfDatabase("Customers, suppliers, and job sites", () => {
  useIntegrationDatabase();

  it("supports customer CRUD and blocks deletion when receipts exist", async () => {
    const admin = await createAuthenticatedRequest({ role: UserRole.ADMIN });

    const createRes = await admin.request
      .post("/customers")
      .set("Cookie", admin.cookie)
      .send({ name: "North Ridge", receiptType: "NORMAL" });

    expect(createRes.status).toBe(201);
    expect(createRes.body).toMatchObject({ name: "North Ridge", receiptType: "NORMAL" });

    const customerId = createRes.body.id as number;
    await createReceipt({ customerId, total: 150 });

    const deleteBlocked = await admin.request
      .delete(`/customers/${customerId}`)
      .set("Cookie", admin.cookie);

    expect(deleteBlocked.status).toBe(400);
    expect(deleteBlocked.body.error).toMatch(/associated receipts/i);

    await prisma.receiptItem.deleteMany({
      where: { receipt: { customerId } },
    });
    await prisma.receipt.deleteMany({ where: { customerId } });

    const deleteRes = await admin.request
      .delete(`/customers/${customerId}`)
      .set("Cookie", admin.cookie);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body).toMatchObject({ message: "Customer deleted" });
  });

  it("supports supplier CRUD and blocks deletion when purchases exist", async () => {
    const admin = await createAuthenticatedRequest({ role: UserRole.ADMIN });
    const product = await createProduct({ name: "3/4 Stone" });

    const createRes = await admin.request
      .post("/suppliers")
      .set("Cookie", admin.cookie)
      .send({ name: "Aggregate Depot" });

    expect(createRes.status).toBe(201);
    const supplierId = createRes.body.id as number;

    await createInventoryPurchase({
      supplierId,
      productId: product.id,
      inventoryNo: "P-LOCKED",
    });

    const deleteBlocked = await admin.request
      .delete(`/suppliers/${supplierId}`)
      .set("Cookie", admin.cookie);

    expect(deleteBlocked.status).toBe(400);
    expect(deleteBlocked.body.error).toMatch(/linked to inventory entries/i);
  });

  it("supports job site CRUD and blocks deletion when receipts exist", async () => {
    const admin = await createAuthenticatedRequest({ role: UserRole.ADMIN });
    const customer = await createCustomer({ name: "Job Site Customer" });

    const createRes = await admin.request
      .post("/job-sites")
      .set("Cookie", admin.cookie)
      .send({ customerId: customer.id, name: "Yard A" });

    expect(createRes.status).toBe(201);
    const jobSiteId = createRes.body.id as number;

    await createReceipt({ customerId: customer.id, jobSiteId, total: 99 });

    const deleteBlocked = await admin.request
      .delete(`/job-sites/${jobSiteId}`)
      .set("Cookie", admin.cookie);

    expect(deleteBlocked.status).toBe(400);
    expect(deleteBlocked.body.error).toMatch(/associated receipts/i);
  });

  it("restricts manual balance overrides to admins", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });
    const customer = await createCustomer();
    const supplier = await createSupplier();

    const customerRes = await manager.request
      .post(`/customers/${customer.id}/manual-balance`)
      .set("Cookie", manager.cookie)
      .send({ amount: 50 });

    expect(customerRes.status).toBe(403);
    expect(customerRes.body.error).toMatch(/insufficient permissions/i);

    const supplierRes = await manager.request
      .post(`/suppliers/${supplier.id}/manual-balance`)
      .set("Cookie", manager.cookie)
      .send({ amount: 50 });

    expect(supplierRes.status).toBe(403);
    expect(supplierRes.body.error).toMatch(/only admins/i);
  });

  it("lists job sites filtered by customer", async () => {
    const admin = await createAuthenticatedRequest({ role: UserRole.ADMIN });
    const customerA = await createCustomer({ name: "Customer A" });
    const customerB = await createCustomer({ name: "Customer B" });
    await createJobSite(customerA.id, "A-1");
    await createJobSite(customerB.id, "B-1");

    const res = await admin.request
      .get(`/job-sites?customerId=${customerA.id}`)
      .set("Cookie", admin.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ customerId: customerA.id, name: "A-1" });
  });
});
