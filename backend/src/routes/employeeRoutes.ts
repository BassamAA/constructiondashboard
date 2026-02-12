import { Router } from "express";
import { EmployeeRole, PayFrequency, PayrollType } from "@prisma/client";
import prisma from "../prismaClient";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const employees = await prisma.employee.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
    });
    res.json(employees);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch employees" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      name,
      role,
      payType,
      salaryAmount,
      salaryFrequency,
      phone,
      notes,
      active = true,
    } = req.body;

    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (!normalizedName) {
      return res.status(400).json({ error: "name is required" });
    }

    const normalizedRole = String(role ?? "").toUpperCase();
    if (!Object.values(EmployeeRole).includes(normalizedRole as EmployeeRole)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const normalizedPayType = String(payType ?? "").toUpperCase();
    if (!Object.values(PayrollType).includes(normalizedPayType as PayrollType)) {
      return res.status(400).json({ error: "Invalid payType" });
    }

    let parsedSalaryAmount: number | null = null;
    let normalizedFrequency: PayFrequency | null = null;

    if (normalizedPayType === PayrollType.SALARY) {
      if (salaryAmount === undefined || salaryAmount === null || Number(salaryAmount) <= 0) {
        return res.status(400).json({ error: "salaryAmount is required for salary employees" });
      }
      parsedSalaryAmount = Number(salaryAmount);
      if (Number.isNaN(parsedSalaryAmount) || parsedSalaryAmount <= 0) {
        return res.status(400).json({ error: "salaryAmount must be a positive number" });
      }
      const freq = String(salaryFrequency ?? "").toUpperCase();
      if (!Object.values(PayFrequency).includes(freq as PayFrequency)) {
        return res.status(400).json({ error: "salaryFrequency must be WEEKLY or MONTHLY" });
      }
      normalizedFrequency = freq as PayFrequency;
    }

    const employee = await prisma.employee.create({
      data: {
        name: normalizedName,
        role: normalizedRole as EmployeeRole,
        payType: normalizedPayType as PayrollType,
        salaryAmount: parsedSalaryAmount,
        salaryFrequency: normalizedFrequency,
        phone: phone?.trim() || null,
        notes: notes?.trim() || null,
        active: Boolean(active),
      },
    });

    res.status(201).json(employee);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to create employee" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid employee id" });
    }

    const {
      name,
      role,
      payType,
      salaryAmount,
      salaryFrequency,
      phone,
      notes,
      active,
    } = req.body;

    const updateData: any = {};

    if (name !== undefined) {
      const normalizedName = String(name).trim();
      if (!normalizedName) {
        return res.status(400).json({ error: "name cannot be empty" });
      }
      updateData.name = normalizedName;
    }

    if (role !== undefined) {
      const normalizedRole = String(role).toUpperCase();
      if (!Object.values(EmployeeRole).includes(normalizedRole as EmployeeRole)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      updateData.role = normalizedRole as EmployeeRole;
    }

    if (payType !== undefined) {
      const normalizedPayType = String(payType).toUpperCase();
      if (!Object.values(PayrollType).includes(normalizedPayType as PayrollType)) {
        return res.status(400).json({ error: "Invalid payType" });
      }
      updateData.payType = normalizedPayType as PayrollType;
    }

    if (salaryAmount !== undefined) {
      if (salaryAmount === null || Number(salaryAmount) <= 0) {
        return res.status(400).json({ error: "salaryAmount must be positive" });
      }
      updateData.salaryAmount = Number(salaryAmount);
    }

    if (salaryFrequency !== undefined) {
      const freq = String(salaryFrequency).toUpperCase();
      if (!Object.values(PayFrequency).includes(freq as PayFrequency)) {
        return res.status(400).json({ error: "Invalid salaryFrequency" });
      }
      updateData.salaryFrequency = freq as PayFrequency;
    }

    if (phone !== undefined) {
      updateData.phone = phone?.trim() || null;
    }

    if (notes !== undefined) {
      updateData.notes = notes?.trim() || null;
    }

    if (active !== undefined) {
      updateData.active = Boolean(active);
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No fields provided to update" });
    }

    const employee = await prisma.employee.update({
      where: { id },
      data: updateData,
    });

    res.json(employee);
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Employee not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update employee" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid employee id" });
    }

    await prisma.employee.update({
      where: { id },
      data: { active: false },
    });

    res.json({ message: "Employee archived" });
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Employee not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to archive employee" });
  }
});

router.get("/:id/piece-rates", async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (Number.isNaN(employeeId)) {
      return res.status(400).json({ error: "Invalid employee id" });
    }
    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, role: true, payType: true },
    });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }

    const pieceRates = await fetchPieceRatesForEmployee(employeeId);

    res.json(pieceRates);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch piece rates" });
  }
});

router.post("/:id/piece-rates", async (req, res) => {
  try {
    const employeeId = Number(req.params.id);
    if (Number.isNaN(employeeId)) {
      return res.status(400).json({ error: "Invalid employee id" });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: employeeId },
      select: { id: true, role: true },
    });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }
    if (employee.role !== EmployeeRole.MANUFACTURING) {
      return res.status(400).json({ error: "Piece rates can only be added for manufacturing staff" });
    }

    const { productId, rate, helperRate } = req.body ?? {};
    const parsedProductId = Number(productId);
    if (Number.isNaN(parsedProductId) || parsedProductId <= 0) {
      return res.status(400).json({ error: "productId is required" });
    }

    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
      select: { id: true, name: true, isManufactured: true },
    });
    if (!product || !product.isManufactured) {
      return res.status(400).json({ error: "Select a valid manufactured product" });
    }

    const parsedRate = Number(rate);
    if (!rate || Number.isNaN(parsedRate) || parsedRate <= 0) {
      return res.status(400).json({ error: "rate must be a positive number" });
    }

    const existing = await prisma.manufacturingPieceRate.findFirst({
      where: { employeeId, productId: parsedProductId },
    });
    if (existing) {
      return res.status(400).json({ error: "This product already has a rate for the employee" });
    }

    const parsedHelperRate =
      helperRate === undefined || helperRate === null || helperRate === ""
        ? null
        : Number(helperRate);
    if (
      parsedHelperRate !== null &&
      (Number.isNaN(parsedHelperRate) || parsedHelperRate <= 0)
    ) {
      return res.status(400).json({ error: "helperRate must be a positive number when provided" });
    }

    const pieceRate = await prisma.manufacturingPieceRate.create({
      data: {
        employeeId,
        productId: parsedProductId,
        rate: parsedRate,
      },
      select: {
        id: true,
      },
    });

    if (parsedHelperRate !== null) {
      await prisma.$executeRaw`
        UPDATE "ManufacturingPieceRate"
        SET "helperRate" = ${parsedHelperRate}
        WHERE "id" = ${pieceRate.id}
      `;
    }

    const response = await fetchPieceRateById(pieceRate.id);

    res.status(201).json(response);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to add piece rate" });
  }
});

router.put("/piece-rates/:pieceRateId", async (req, res) => {
  try {
    const pieceRateId = Number(req.params.pieceRateId);
    if (Number.isNaN(pieceRateId)) {
      return res.status(400).json({ error: "Invalid piece rate id" });
    }

    const { rate, helperRate, isActive } = req.body ?? {};
    const updateData: Record<string, unknown> = {};

    if (rate !== undefined) {
      const parsedRate = Number(rate);
      if (Number.isNaN(parsedRate) || parsedRate <= 0) {
        return res.status(400).json({ error: "rate must be a positive number" });
      }
      updateData.rate = parsedRate;
    }

    let helperRateUpdateValue: number | null | undefined = undefined;
    if (helperRate !== undefined) {
      if (helperRate === null || helperRate === "") {
        helperRateUpdateValue = null;
      } else {
        const parsedHelperRate = Number(helperRate);
        if (Number.isNaN(parsedHelperRate) || parsedHelperRate <= 0) {
          return res.status(400).json({ error: "helperRate must be a positive number" });
        }
        helperRateUpdateValue = parsedHelperRate;
      }
    }

    if (isActive !== undefined) {
      updateData.isActive = Boolean(isActive);
    }

    if (Object.keys(updateData).length === 0 && helperRateUpdateValue === undefined) {
      return res.status(400).json({ error: "No fields provided to update" });
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.manufacturingPieceRate.update({
        where: { id: pieceRateId },
        data: updateData,
        select: { id: true },
      });
    }

    if (helperRateUpdateValue !== undefined) {
      await prisma.$executeRaw`
        UPDATE "ManufacturingPieceRate"
        SET "helperRate" = ${helperRateUpdateValue}
        WHERE "id" = ${pieceRateId}
      `;
    }

    const response = await fetchPieceRateById(pieceRateId);

    res.json(response);
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Piece rate not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update piece rate" });
  }
});

async function fetchPieceRatesForEmployee(employeeId: number) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      employeeId: number;
      productId: number;
      rate: number;
      helperRate: number | null;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
      productName: string | null;
    }>
  >`
    SELECT mpr."id",
           mpr."employeeId",
           mpr."productId",
           mpr."rate",
           mpr."helperRate",
           mpr."isActive",
           mpr."createdAt",
           mpr."updatedAt",
           p."name" AS "productName"
    FROM "ManufacturingPieceRate" mpr
    LEFT JOIN "Product" p ON p."id" = mpr."productId"
    WHERE mpr."employeeId" = ${employeeId}
    ORDER BY mpr."isActive" DESC, mpr."createdAt" ASC
  `;

  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    productId: row.productId,
    rate: Number(row.rate),
    helperRate: row.helperRate === null ? null : Number(row.helperRate),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    product: row.productId
      ? { id: row.productId, name: row.productName ?? "Product" }
      : null,
  }));
}

async function fetchPieceRateById(id: number) {
  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      employeeId: number;
      productId: number;
      rate: number;
      helperRate: number | null;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
      productName: string | null;
    }>
  >`
    SELECT mpr."id",
           mpr."employeeId",
           mpr."productId",
           mpr."rate",
           mpr."helperRate",
           mpr."isActive",
           mpr."createdAt",
           mpr."updatedAt",
           p."name" AS "productName"
    FROM "ManufacturingPieceRate" mpr
    LEFT JOIN "Product" p ON p."id" = mpr."productId"
    WHERE mpr."id" = ${id}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    employeeId: row.employeeId,
    productId: row.productId,
    rate: Number(row.rate),
    helperRate: row.helperRate === null ? null : Number(row.helperRate),
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    product: row.productId ? { id: row.productId, name: row.productName ?? "Product" } : null,
  };
}

router.delete("/piece-rates/:pieceRateId", async (req, res) => {
  try {
    const pieceRateId = Number(req.params.pieceRateId);
    if (Number.isNaN(pieceRateId)) {
      return res.status(400).json({ error: "Invalid piece rate id" });
    }
    await prisma.manufacturingPieceRate.delete({ where: { id: pieceRateId } });
    res.json({ message: "Piece rate deleted" });
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Piece rate not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to delete piece rate" });
  }
});

export default router;
