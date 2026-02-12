import { Router } from "express";
import { PaymentType, TruckMaintenanceType } from "@prisma/client";
import prisma from "../prismaClient";
import { logAudit } from "../utils/auditLogger";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const trucks = await prisma.truck.findMany({
      orderBy: { plateNo: "asc" },
      include: { driver: true },
    });
    res.json(trucks);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch trucks" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { plateNo, driverId, insuranceExpiry } = req.body;

    const normalizedPlate = typeof plateNo === "string" ? plateNo.trim() : "";
    if (!normalizedPlate) {
      return res.status(400).json({ error: "plateNo is required" });
    }

    let parsedDriverId: number | null = null;
    if (driverId !== undefined && driverId !== null && `${driverId}`.trim() !== "") {
      parsedDriverId = Number(driverId);
      if (Number.isNaN(parsedDriverId)) {
        return res.status(400).json({ error: "Invalid driverId" });
      }
      const driver = await prisma.driver.findUnique({ where: { id: parsedDriverId } });
      if (!driver) {
        return res.status(400).json({ error: "Driver not found" });
      }
    }

    const truck = await prisma.truck.create({
      data: {
        plateNo: normalizedPlate,
        driverId: parsedDriverId,
        insuranceExpiry:
          insuranceExpiry && `${insuranceExpiry}`.trim().length > 0
            ? new Date(insuranceExpiry)
            : null,
      },
      include: { driver: true },
    });

    res.status(201).json(truck);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to create truck" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid truck id" });
    }

    const { plateNo, driverId, insuranceExpiry } = req.body;
    const updateData: Record<string, unknown> = {};

    if (plateNo !== undefined) {
      const normalizedPlate = typeof plateNo === "string" ? plateNo.trim() : "";
      if (!normalizedPlate) {
        return res.status(400).json({ error: "plateNo is required" });
      }
      updateData.plateNo = normalizedPlate;
    }

    if (driverId !== undefined) {
      if (driverId === null || `${driverId}`.trim() === "") {
        updateData.driverId = null;
      } else {
        const parsedDriverId = Number(driverId);
        if (Number.isNaN(parsedDriverId)) {
          return res.status(400).json({ error: "Invalid driverId" });
        }
        const driver = await prisma.driver.findUnique({ where: { id: parsedDriverId } });
        if (!driver) {
          return res.status(400).json({ error: "Driver not found" });
        }
        updateData.driverId = parsedDriverId;
      }
    }

    if (insuranceExpiry !== undefined) {
      if (!insuranceExpiry) {
        updateData.insuranceExpiry = null;
      } else {
        const parsedDate = new Date(insuranceExpiry);
        if (Number.isNaN(parsedDate.getTime())) {
          return res.status(400).json({ error: "Invalid insuranceExpiry" });
        }
        updateData.insuranceExpiry = parsedDate;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No fields provided to update" });
    }

    const truck = await prisma.truck.update({
      where: { id },
      data: updateData,
      include: { driver: true },
    });

    res.json(truck);
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Truck not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update truck" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid truck id" });
    }

    const receiptCount = await prisma.receipt.count({ where: { truckId: id } });
    if (receiptCount > 0) {
      return res
        .status(400)
        .json({ error: "Cannot delete a truck that is referenced by receipts" });
    }

    await prisma.truck.delete({ where: { id } });
    res.json({ message: "Truck deleted" });
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Truck not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to delete truck" });
  }
});

router.get("/:id/repairs", async (req, res) => {
  try {
    const truckId = Number(req.params.id);
    if (Number.isNaN(truckId)) {
      return res.status(400).json({ error: "Invalid truck id" });
    }

    const repairs = await prisma.truckRepair.findMany({
      where: { truckId },
      orderBy: { date: "desc" },
      include: {
        supplier: true,
        payment: true,
        tool: true,
      },
    });

    res.json(repairs);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to load truck repairs" });
  }
});

router.post("/:id/repairs", async (req, res) => {
  try {
    const truckId = Number(req.params.id);
    if (Number.isNaN(truckId)) {
      return res.status(400).json({ error: "Invalid truck id" });
    }

    const truck = await prisma.truck.findUnique({ where: { id: truckId } });
    if (!truck) {
      return res.status(404).json({ error: "Truck not found" });
    }

    const { amount, description, supplierId, date, type, toolId, quantity } = req.body ?? {};
    const parsedAmount = Number(amount);

    let parsedSupplierId: number | null = null;
    if (supplierId !== undefined && supplierId !== null && `${supplierId}`.trim() !== "") {
      parsedSupplierId = Number(supplierId);
      if (Number.isNaN(parsedSupplierId)) {
        return res.status(400).json({ error: "Invalid supplierId" });
      }
      const supplier = await prisma.supplier.findUnique({ where: { id: parsedSupplierId } });
      if (!supplier) {
        return res.status(400).json({ error: "Supplier not found" });
      }
    }

    const normalizedType =
      typeof type === "string" && Object.values(TruckMaintenanceType).includes(type as any)
        ? (type as TruckMaintenanceType)
        : TruckMaintenanceType.REPAIR;

    const categoryLabel =
      normalizedType === TruckMaintenanceType.OIL_CHANGE
        ? "Oil change"
        : normalizedType === TruckMaintenanceType.INSURANCE
          ? "Insurance"
          : "Truck repair";

    const parsedQuantity = quantity === undefined ? 0 : Number(quantity);
    if (normalizedType === TruckMaintenanceType.OIL_CHANGE) {
      if (Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
        return res.status(400).json({ error: "Quantity (liters) must be greater than zero" });
      }
      const oilToolId = toolId ? Number(toolId) : null;
      if (!oilToolId || Number.isNaN(oilToolId)) {
        return res.status(400).json({ error: "Select an oil stock item" });
      }
      const repair = await prisma.$transaction(async (tx) => {
        const tool = await tx.tool.findUnique({ where: { id: oilToolId } });
        if (!tool) {
          throw new Error("Tool not found");
        }
        if (Number(tool.quantity) < parsedQuantity) {
          throw new Error("Not enough stock for selected tool");
        }
        await tx.tool.update({
          where: { id: oilToolId },
          data: { quantity: Number(tool.quantity) - parsedQuantity },
        });
        return tx.truckRepair.create({
          data: {
            truckId,
            amount: 0,
            quantity: parsedQuantity,
            toolId: oilToolId,
            supplierId: null,
            description: description?.trim() || null,
            date: date ? new Date(date) : undefined,
            type: normalizedType,
            paymentId: null,
          },
          include: {
            supplier: true,
            payment: true,
            tool: true,
          },
        });
      });

      await logAudit({
        action: "TRUCK_REPAIR_LOGGED",
        entityType: "truckRepair",
        entityId: repair.id,
        description: `${categoryLabel} recorded for truck ${truck.plateNo}`,
        metadata: {
          truckId,
          quantity: repair.quantity,
          toolId: repair.toolId,
          type: normalizedType,
        },
      });

      return res.status(201).json(repair);
    }

    if (amount === undefined || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "Amount must be greater than zero" });
    }

    const repair = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          amount: parsedAmount,
          type: parsedSupplierId ? PaymentType.SUPPLIER : PaymentType.GENERAL_EXPENSE,
          supplierId: parsedSupplierId,
          description: description?.trim() || `${categoryLabel} for ${truck.plateNo}`,
          category: categoryLabel,
          reference: `truck-${truckId}-repair`,
          date: date ? new Date(date) : undefined,
        },
      });

      return tx.truckRepair.create({
        data: {
          truckId,
          amount: parsedAmount,
          quantity: 0,
          toolId: null,
          supplierId: parsedSupplierId,
          description: description?.trim() || null,
          date: date ? new Date(date) : undefined,
          type: normalizedType,
          paymentId: payment.id,
        },
        include: {
          supplier: true,
          payment: true,
          tool: true,
        },
      });
    });

    await logAudit({
      action: "TRUCK_REPAIR_LOGGED",
      entityType: "truckRepair",
      entityId: repair.id,
      description: `Repair recorded for truck ${truck.plateNo}`,
      metadata: {
        truckId,
        amount: repair.amount,
        supplierId: repair.supplierId,
        type: normalizedType,
        quantity: repair.quantity,
        toolId: repair.toolId,
      },
    });

    res.status(201).json(repair);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to log truck repair" });
  }
});

export default router;
