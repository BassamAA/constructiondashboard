import { UserRole } from "@prisma/client";
import prisma from "../../src/prismaClient";
import {
  createAuthenticatedRequest,
  createEmployee,
  createPayrollEntry,
  describeIfDatabase,
  useIntegrationDatabase,
} from "./helpers";

describeIfDatabase("Payroll routes", () => {
  useIntegrationDatabase();

  it("creates a salary payroll entry", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.ADMIN });
    const employee = await createEmployee({
      name: "Salary Employee",
      payType: "SALARY",
      salaryAmount: 1500,
      salaryFrequency: "WEEKLY",
    });

    const res = await manager.request
      .post("/payroll")
      .set("Cookie", manager.cookie)
      .send({
        employeeId: employee.id,
        amount: 1500,
      });

    expect(res.status).toBe(201);
    expect(res.body.employeeId).toBe(employee.id);
    expect(res.body.amount).toBe(1500);
    expect(res.body.type).toBe("SALARY");
  });

  it("creates and debits a payroll run from existing entries", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.ADMIN });
    const employee = await createEmployee({
      name: "Run Employee",
      payType: "SALARY",
      salaryAmount: 900,
      salaryFrequency: "WEEKLY",
    });
    const periodStart = new Date("2026-03-01T00:00:00.000Z");
    const periodEnd = new Date("2026-03-07T00:00:00.000Z");
    const entry = await createPayrollEntry({
      employeeId: employee.id,
      type: "SALARY",
      amount: 900,
      periodStart,
      periodEnd,
    });

    const createdRun = await manager.request
      .post("/payroll/runs")
      .set("Cookie", manager.cookie)
      .send({
        frequency: "WEEKLY",
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        entryIds: [entry.id],
      });

    expect(createdRun.status).toBe(201);
    expect(createdRun.body.entries).toHaveLength(1);

    const debited = await manager.request
      .post(`/payroll/runs/${createdRun.body.id}/debit`)
      .set("Cookie", manager.cookie)
      .send({});

    expect(debited.status).toBe(200);
    expect(debited.body.status).toBe("PAID");

    const payment = await prisma.payment.findFirst({
      where: { payrollRunId: createdRun.body.id },
    });
    expect(payment).not.toBeNull();
    expect(payment?.amount).toBe(900);
  });

  it("validates missing quantity for piecework entries", async () => {
    const manager = await createAuthenticatedRequest({ role: UserRole.ADMIN });
    const employee = await createEmployee({
      payType: "PIECEWORK",
      salaryAmount: null,
      salaryFrequency: null,
    });

    const res = await manager.request
      .post("/payroll")
      .set("Cookie", manager.cookie)
      .send({
        employeeId: employee.id,
        type: "PIECEWORK",
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/quantity is required/i);
  });
});
