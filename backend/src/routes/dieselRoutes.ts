import { Router } from "express";
import { InventoryEntryType, StockMovementType } from "@prisma/client";
import prisma from "../prismaClient";
import { logAudit } from "../utils/auditLogger";

const router = Router();

const findFuelProduct = async (productId?: number) => {
  if (productId) {
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (product) {
      return product;
    }
  }
  const flagged = await prisma.product.findFirst({ where: { isFuel: true } });
  if (flagged) return flagged;
  const dieselByName = await prisma.product.findFirst({
    where: {
      name: {
        contains: "diesel",
        mode: "insensitive",
      },
    },
  });
  return dieselByName;
};

router.get("/purchases", async (_req, res) => {
  try {
    const purchases = await prisma.inventoryEntry.findMany({
      where: {
        type: InventoryEntryType.PURCHASE,
        product: {
          OR: [
            { isFuel: true },
            {
              name: {
                contains: "diesel",
                mode: "insensitive",
              },
            },
          ],
        },
      },
      include: {
        supplier: true,
        product: true,
      },
      orderBy: { entryDate: "desc" },
    });

    const totalLiters = purchases.reduce((sum, entry) => sum + Number(entry.quantity), 0);
    const totalCost = purchases.reduce((sum, entry) => sum + Number(entry.totalCost ?? 0), 0);

    res.json({
      purchases,
      totals: {
        liters: totalLiters,
        cost: totalCost,
      },
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch diesel purchases" });
  }
});

router.get("/logs", async (_req, res) => {
  try {
    const logs = await prisma.dieselLog.findMany({
      include: {
        truck: true,
        driver: true,
      },
      orderBy: { date: "desc" },
    });

    const totalLiters = logs.reduce((sum, log) => sum + Number(log.liters), 0);
    const totalCost = logs.reduce((sum, log) => sum + Number(log.totalCost ?? 0), 0);

    res.json({
      logs,
      totals: {
        liters: totalLiters,
        cost: totalCost,
      },
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch diesel usage logs" });
  }
});

router.post("/logs", async (req, res) => {
  try {
    const {
      date,
      truckId,
      driverId,
      liters,
      pricePerLiter,
      totalCost,
      notes,
      productId,
    } = req.body;

    const parsedLiters = Number(liters);
    if (Number.isNaN(parsedLiters) || parsedLiters <= 0) {
      return res.status(400).json({ error: "liters must be a positive number" });
    }

    const parsedTruckId = truckId === undefined || truckId === null || truckId === ""
      ? null
      : Number(truckId);
    if (parsedTruckId !== null && Number.isNaN(parsedTruckId)) {
      return res.status(400).json({ error: "Invalid truckId" });
    }

    const parsedDriverId = driverId === undefined || driverId === null || driverId === ""
      ? null
      : Number(driverId);
    if (parsedDriverId !== null && Number.isNaN(parsedDriverId)) {
      return res.status(400).json({ error: "Invalid driverId" });
    }

    const parsedDate = date ? new Date(date) : new Date();
    if (Number.isNaN(parsedDate.getTime())) {
      return res.status(400).json({ error: "Invalid date" });
    }

    const product = await findFuelProduct(productId ? Number(productId) : undefined);
    if (!product) {
      return res.status(400).json({ error: "No diesel/fuel product found. Create a product and mark it as fuel." });
    }

    const parsedPricePerLiter = pricePerLiter !== undefined && pricePerLiter !== null && `${pricePerLiter}`.trim() !== ""
      ? Number(pricePerLiter)
      : null;
    if (parsedPricePerLiter !== null && Number.isNaN(parsedPricePerLiter)) {
      return res.status(400).json({ error: "pricePerLiter must be a valid number" });
    }

    let parsedTotalCost: number | null = null;
    if (totalCost !== undefined && totalCost !== null && `${totalCost}`.trim() !== "") {
      const rawTotal = Number(totalCost);
      if (Number.isNaN(rawTotal)) {
        return res.status(400).json({ error: "totalCost must be a valid number" });
      }
      parsedTotalCost = rawTotal;
    } else if (parsedPricePerLiter !== null) {
      parsedTotalCost = parsedPricePerLiter * parsedLiters;
    }

    const dieselLog = await prisma.$transaction(async (tx) => {
      const created = await tx.dieselLog.create({
        data: {
          date: parsedDate,
          truckId: parsedTruckId,
          driverId: parsedDriverId,
          liters: parsedLiters,
          pricePerLiter: parsedPricePerLiter,
          totalCost: parsedTotalCost,
          notes: typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null,
        },
        include: {
          truck: true,
          driver: true,
        },
      });

      await tx.product.update({
        where: { id: product.id },
        data: {
          stockQty: { decrement: parsedLiters },
        },
      });

      await tx.stockMovement.create({
        data: {
          productId: product.id,
          quantity: -parsedLiters,
          type: StockMovementType.PRODUCTION_CONSUMPTION,
          date: parsedDate,
        },
      });

      return created;
    });

    await logAudit({
      action: "DIESEL_LOG_CREATED",
      entityType: "dieselLog",
      entityId: dieselLog.id,
      description: `Logged ${dieselLog.liters}L diesel${dieselLog.truckId ? ` for truck ${dieselLog.truckId}` : ""}`,
      metadata: {
        liters: Number(dieselLog.liters),
        truckId: dieselLog.truckId,
        driverId: dieselLog.driverId,
        totalCost: dieselLog.totalCost !== null && dieselLog.totalCost !== undefined ? Number(dieselLog.totalCost) : null,
      },
    });

    res.status(201).json(dieselLog);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to log diesel usage" });
  }
});

export default router;
