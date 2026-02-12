import request from "supertest";
import { app } from "../../src/app";
import prisma from "../../src/prismaClient";

describe("Health endpoints", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns service health", async () => {
    const res = await request(app).get("/health");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.uptimeSeconds).toBe("number");
    expect(typeof res.body.timestamp).toBe("string");
  });

  it("returns ready when database probe succeeds", async () => {
    vi.spyOn(prisma, "$queryRaw").mockResolvedValue([{ ok: 1 }] as any);

    const res = await request(app).get("/ready");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ready" });
  });

  it("returns not ready when database probe fails", async () => {
    vi.spyOn(prisma, "$queryRaw").mockRejectedValue(new Error("database unavailable"));

    const res = await request(app).get("/ready");

    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "not_ready", error: "database unavailable" });
  });
});
