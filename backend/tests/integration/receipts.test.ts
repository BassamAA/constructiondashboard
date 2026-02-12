import request from "supertest";
import { app } from "../../src/app";

describe("Receipts routes", () => {
  it("requires authentication for receipts list", async () => {
    const res = await request(app).get("/receipts");
    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ error: "Authentication required" });
  });
});
