import request from "supertest";
import { app } from "../../src/app";
import prisma from "../../src/prismaClient";
import * as passwordUtils from "../../src/utils/password";
import * as sessionService from "../../src/utils/sessionService";
import { UserRole } from "@prisma/client";

describe("Auth routes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects login without credentials", async () => {
    const res = await request(app).post("/auth/login").send({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "Email and password are required" });
  });

  it("rejects login when credentials are invalid", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue(null);

    const res = await request(app).post("/auth/login").send({
      email: "missing@example.com",
      password: "wrong",
    });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "Invalid credentials" });
  });

  it("logs in successfully and sets session cookie", async () => {
    vi.spyOn(prisma.user, "findUnique").mockResolvedValue({
      id: 101,
      email: "manager@example.com",
      name: "Manager User",
      role: UserRole.MANAGER,
      passwordHash: "hashed",
      permissions: null,
    } as any);
    vi.spyOn(passwordUtils, "verifyPassword").mockResolvedValue(true);
    vi.spyOn(sessionService, "createSession").mockResolvedValue({
      rawToken: "token-123",
      session: { id: "session-1" },
    } as any);

    const res = await request(app).post("/auth/login").send({
      email: "manager@example.com",
      password: "valid-password",
    });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "manager@example.com",
      role: UserRole.MANAGER,
    });
    expect(res.headers["set-cookie"]?.[0]).toContain("sid=token-123");
  });

  it("returns current user for a valid session", async () => {
    vi.spyOn(prisma.session, "findUnique").mockResolvedValue({
      id: "session-2",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user: {
        id: 202,
        email: "admin@example.com",
        name: "Admin User",
        role: UserRole.ADMIN,
        permissions: null,
      },
    } as any);

    const res = await request(app).get("/auth/me").set("Cookie", "sid=token-xyz");

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      email: "admin@example.com",
      role: UserRole.ADMIN,
    });
  });

  it("rejects /auth/me without session cookie", async () => {
    const res = await request(app).get("/auth/me");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "Authentication required" });
  });
});
