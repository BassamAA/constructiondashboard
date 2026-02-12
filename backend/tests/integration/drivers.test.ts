import request from "supertest";
import { app } from "../../src/app";
import prisma from "../../src/prismaClient";
import { UserRole } from "@prisma/client";

describe("Drivers routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requires authentication for drivers list", async () => {
    const res = await request(app).get("/drivers");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "Authentication required" });
  });

  it("allows a manager to list drivers", async () => {
    vi.spyOn(prisma.session, "findUnique").mockResolvedValue({
      id: "session-manager",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 1,
        email: "manager@example.com",
        name: "Manager",
        role: UserRole.MANAGER,
        permissions: null,
      },
    } as any);
    vi.spyOn(prisma.driver, "findMany").mockResolvedValue([
      { id: 1, name: "Driver One", phone: "123", driverId: null },
    ] as any);

    const res = await request(app).get("/drivers").set("Cookie", "sid=valid-manager-token");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0]).toMatchObject({ name: "Driver One" });
  });

  it("forbids a worker from listing drivers", async () => {
    vi.spyOn(prisma.session, "findUnique").mockResolvedValue({
      id: "session-worker",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 2,
        email: "worker@example.com",
        name: "Worker",
        role: UserRole.WORKER,
        permissions: null,
      },
    } as any);

    const res = await request(app).get("/drivers").set("Cookie", "sid=valid-worker-token");

    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: "Insufficient permissions" });
  });
});
