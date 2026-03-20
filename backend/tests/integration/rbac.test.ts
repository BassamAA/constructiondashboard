import request from "supertest";
import { UserRole } from "@prisma/client";
import { app } from "../../src/app";
import {
  createAuthenticatedRequest,
  describeIfDatabase,
  useIntegrationDatabase,
} from "./helpers";

describeIfDatabase("RBAC and permission boundaries", () => {
  useIntegrationDatabase();

  it("blocks workers from manager-only modules", async () => {
    const worker = await createAuthenticatedRequest({ role: UserRole.WORKER });

    const res = await worker.request
      .get("/customers")
      .set("Cookie", worker.cookie);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "Insufficient permissions" });
  });

  it("blocks managers who lack explicit module permission", async () => {
    const manager = await createAuthenticatedRequest({
      role: UserRole.MANAGER,
      permissions: { "reports:view": false },
    });

    const res = await manager.request
      .get("/reports/summary")
      .set("Cookie", manager.cookie);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: "You do not have permission to perform this action",
    });
  });

  it("allows admins to access restricted modules", async () => {
    const admin = await createAuthenticatedRequest({ role: UserRole.ADMIN });

    const res = await admin.request
      .get("/customers")
      .set("Cookie", admin.cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("denies manager inventory access when inventory permission is revoked", async () => {
    const manager = await createAuthenticatedRequest({
      role: UserRole.MANAGER,
      permissions: { "inventory:manage": false },
    });

    const res = await manager.request
      .get("/inventory")
      .set("Cookie", manager.cookie);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      error: "You do not have permission to perform this action",
    });
  });

  it("blocks workers from all write operations system-wide", async () => {
    const worker = await createAuthenticatedRequest({ role: UserRole.WORKER });

    const res = await worker.request
      .post("/customers")
      .set("Cookie", worker.cookie)
      .send({ name: "Blocked Customer", receiptType: "NORMAL" });

    expect(res.status).toBe(403);
  });

  it("blocks managers from admin-only routes", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.MANAGER });

    const res = await manager.request
      .get("/audit-logs")
      .set("Cookie", manager.cookie);

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "Insufficient permissions" });
  });

  it("allows admins to access audit logs", async () => {
    const admin = await createAuthenticatedRequest({ role: UserRole.ADMIN });

    const res = await admin.request
      .get("/audit-logs")
      .set("Cookie", admin.cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("rejects requests with an invalid session cookie", async () => {
    const res = await request(app)
      .get("/customers")
      .set("Cookie", "sid=totally-invalid-token");

    expect(res.status).toBe(401);
  });
});
