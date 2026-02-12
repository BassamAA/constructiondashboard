import { Router } from "express";
import {
  EmployeeRole,
  InventoryEntryType,
  PaymentType,
  StockMovementType,
  Prisma,
} from "@prisma/client";
import prisma from "../prismaClient";
import { logAudit } from "../utils/auditLogger";
import { computeInventoryAmount } from "../utils/cashFlows";

const router = Router();

const inventoryNumberPattern = /^(\D*?)(\d+)(.*)$/;

const incrementInventoryNumber = (value: string | null | undefined, fallback: string) => {
  const defaultNumber = fallback;
  if (!value) return defaultNumber;
  const trimmed = value.trim();
  if (trimmed.length === 0) return defaultNumber;

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    if (/^0\d+$/.test(trimmed)) {
      return String(numeric + 1).padStart(trimmed.length, "0");
    }
    return String(numeric + 1);
  }

  const match = trimmed.match(inventoryNumberPattern);
  if (!match) {
    return defaultNumber;
  }
  const [, prefix, digits, suffix] = match;
  const incremented = String(Number(digits) + 1).padStart(digits.length, "0");
  return `${prefix}${incremented}${suffix ?? ""}`;
};

const defaultSeedForInventoryType = (type: InventoryEntryType) =>
  type === InventoryEntryType.PURCHASE ? "P1" : "M1";

async function generateNextInventoryNumber(tx: Prisma.TransactionClient, type: InventoryEntryType) {
  const latest = await tx.inventoryEntry.findFirst({
    where: {
      type,
      inventoryNo: {
        startsWith: type === InventoryEntryType.PURCHASE ? "P" : "M",
        mode: "insensitive",
      },
    },
    orderBy: { id: "desc" },
    select: { inventoryNo: true },
  });
  return incrementInventoryNumber(latest?.inventoryNo ?? null, defaultSeedForInventoryType(type));
}

class InventoryNumberValidationError extends Error {
  status: number;
  expectedNext?: string;
  constructor(message: string, status = 400, expectedNext?: string) {
    super(message);
    this.name = "InventoryNumberValidationError";
    this.status = status;
    this.expectedNext = expectedNext;
  }
}

async function requireNextInventoryNumber(
  tx: Prisma.TransactionClient,
  type: InventoryEntryType,
  provided: string | null,
) {
  const expected = await generateNextInventoryNumber(tx, type);
  const prefix = type === InventoryEntryType.PURCHASE ? "P" : "M";
  if (provided) {
    const trimmed = provided.trim();
    if (!trimmed.toUpperCase().startsWith(prefix)) {
      throw new InventoryNumberValidationError(
        `${type} entries must start with "${prefix}". Next expected is ${expected}.`,
        400,
        expected,
      );
    }
    if (trimmed !== expected) {
      throw new InventoryNumberValidationError(
        `Inventory entry out of sequence. Next ${type} entry should be ${expected}.`,
        409,
        expected,
      );
    }
    return trimmed;
  }
  return expected;
}

const inventoryInclude = {
  supplier: true,
  product: true,
  powderProduct: true,
  cementProduct: true,
  workerEmployee: true,
  helperEmployee: true,
};

router.get("/", async (req, res) => {
  try {
    const where: Prisma.InventoryEntryWhereInput = {};
    const productIdRaw = req.query.productId;
    if (productIdRaw !== undefined && `${productIdRaw}`.trim() !== "") {
      const parsedProductId = Number(productIdRaw);
      if (Number.isNaN(parsedProductId)) {
        return res.status(400).json({ error: "Invalid productId filter" });
      }
      where.productId = parsedProductId;
    }
    const pageRaw = Number(req.query.page ?? 1);
    const pageSizeRaw = Number(req.query.pageSize ?? 25);
    const parsedPage = Number.isNaN(pageRaw) || pageRaw < 1 ? 1 : Math.floor(pageRaw);
    const normalizedPageSize =
      Number.isNaN(pageSizeRaw) || pageSizeRaw < 1 ? 25 : Math.min(200, Math.floor(pageSizeRaw));
    const skip = (parsedPage - 1) * normalizedPageSize;
    const sortFieldRaw = typeof req.query.sortBy === "string" ? req.query.sortBy : "entryDate";
    const orderRaw = `${req.query.order ?? "desc"}`.toLowerCase();
    const sortOrder: Prisma.SortOrder = orderRaw === "asc" ? "asc" : "desc";
    const allowedSortFields = new Set(["entryDate", "createdAt", "quantity", "productName"]);
    const sortBy = allowedSortFields.has(sortFieldRaw) ? sortFieldRaw : "entryDate";

    const [total, entries] = await Promise.all([
      prisma.inventoryEntry.count({ where }),
      prisma.inventoryEntry.findMany({
        where,
        include: inventoryInclude,
        orderBy:
          sortBy === "productName"
            ? [
                { product: { name: sortOrder } },
                { entryDate: sortOrder } as any,
                { id: sortOrder } as any,
              ]
            : [
                { [sortBy]: sortOrder } as any,
                { id: sortOrder } as any,
              ],
        skip,
        take: normalizedPageSize,
      }),
    ]);
    res.json({
      entries,
      total,
      page: parsedPage,
      pageSize: normalizedPageSize,
      totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
      sortBy,
      order: sortOrder,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch inventory entries" });
  }
});

router.get("/production-history", async (req, res) => {
  try {
    const orderRaw = `${req.query.order ?? "desc"}`.toLowerCase();
    const sortOrder: Prisma.SortOrder = orderRaw === "asc" ? "asc" : "desc";
    const pageRaw = Number(req.query.page ?? 1);
    const pageSizeRaw = Number(req.query.pageSize ?? 25);
    const parsedPage = Number.isNaN(pageRaw) || pageRaw < 1 ? 1 : Math.floor(pageRaw);
    const normalizedPageSize = Number.isNaN(pageSizeRaw) || pageSizeRaw < 1 ? 25 : Math.min(200, Math.floor(pageSizeRaw));
    const skip = (parsedPage - 1) * normalizedPageSize;
    const where: Prisma.InventoryEntryWhereInput = {
      type: InventoryEntryType.PRODUCTION,
    };
    const productIdRaw = req.query.productId;
    if (productIdRaw !== undefined && `${productIdRaw}`.trim() !== "") {
      const parsedProductId = Number(productIdRaw);
      if (Number.isNaN(parsedProductId)) {
        return res.status(400).json({ error: "Invalid productId filter" });
      }
      where.productId = parsedProductId;
    }

    const [total, entries] = await Promise.all([
      prisma.inventoryEntry.count({ where }),
      prisma.inventoryEntry.findMany({
        where,
        include: inventoryInclude,
        orderBy: [
          { entryDate: sortOrder } as any,
          { createdAt: sortOrder } as any,
          { id: sortOrder } as any,
        ],
        skip,
        take: normalizedPageSize,
      }),
    ]);

    res.json({
      entries,
      total,
      page: parsedPage,
      pageSize: normalizedPageSize,
      totalPages: Math.max(1, Math.ceil(total / normalizedPageSize)),
      order: sortOrder,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch production history" });
  }
});

router.get("/next-number", async (_req, res) => {
  try {
    const [purchaseNext, productionNext] = await prisma.$transaction(async (tx) => {
      const p = await generateNextInventoryNumber(tx, InventoryEntryType.PURCHASE);
      const m = await generateNextInventoryNumber(tx, InventoryEntryType.PRODUCTION);
      return [p, m];
    });
    res.json({ purchase: purchaseNext, production: productionNext });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to determine next inventory numbers" });
  }
});

router.get("/workers", async (_req, res) => {
  try {
    const workers = await prisma.employee.findMany({
      where: { active: true, role: EmployeeRole.MANUFACTURING },
      orderBy: [{ name: "asc" }],
    });

    const workerIds = workers.map((worker) => worker.id);
    const pieceRateRows =
      workerIds.length === 0
        ? []
        : await prisma.$queryRaw<
            Array<{
              id: number;
              employeeId: number;
              productId: number;
              rate: number;
              helperRate: number | null;
              isActive: boolean;
              createdAt: Date;
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
                   p."name" AS "productName"
            FROM "ManufacturingPieceRate" mpr
            LEFT JOIN "Product" p ON p."id" = mpr."productId"
            WHERE mpr."employeeId" IN (${Prisma.join(workerIds)})
          `;

    const pieceRatesByEmployee = new Map<number, any[]>();
    pieceRateRows.forEach((row) => {
      if (!pieceRatesByEmployee.has(row.employeeId)) {
        pieceRatesByEmployee.set(row.employeeId, []);
      }
      pieceRatesByEmployee.get(row.employeeId)!.push({
        id: row.id,
        employeeId: row.employeeId,
        productId: row.productId,
        rate: Number(row.rate),
        helperRate: row.helperRate === null ? null : Number(row.helperRate),
        isActive: row.isActive,
        createdAt: row.createdAt,
        product: row.productId ? { id: row.productId, name: row.productName ?? "Product" } : null,
      });
    });

    const enrichedWorkers = workers.map((worker) => ({
      ...worker,
      pieceRates: pieceRatesByEmployee.get(worker.id) ?? [],
    }));

    res.json(enrichedWorkers);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch workers" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      inventoryNo,
      type,
      supplierId,
      productId,
      quantity,
      powderUsed,
      powderProductId,
      cementUsed,
      cementProductId,
      notes,
      date,
      unitCost,
      isPaid,
      laborPaid,
      laborAmount,
      helperLaborAmount,
      workerEmployeeId,
      helperEmployeeId,
      tvaEligible,
    } = req.body;

    const normalizedType = String(type ?? "").toUpperCase() as InventoryEntryType;
    if (!Object.values(InventoryEntryType).includes(normalizedType)) {
      return res.status(400).json({ error: "type must be PURCHASE or PRODUCTION" });
    }

    const parsedProductId = Number(productId);
    const parsedQuantity = Number(quantity);

    if (!productId || Number.isNaN(parsedProductId)) {
      return res.status(400).json({ error: "productId is required" });
    }
    if (Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ error: "quantity must be greater than zero" });
    }

    const trimmedInventoryNo =
      typeof inventoryNo === "string" && inventoryNo.trim().length > 0 ? inventoryNo.trim() : null;

    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
      select: {
        isManufactured: true,
        productionPowderProductId: true,
        productionPowderQuantity: true,
        productionCementProductId: true,
        productionCementQuantity: true,
        pieceworkRate: true,
        helperPieceworkRate: true,
      },
    });

    if (!product) {
      return res.status(400).json({ error: "Product not found" });
    }

    let parsedSupplierId: number | null = null;
    let parsedUnitCost: number | null = null;
    let normalizedIsPaid = true;
    let normalizedTvaEligible = false;
    const parsedEntryDate = date ? new Date(date) : new Date();
    if (Number.isNaN(parsedEntryDate.getTime())) {
      return res.status(400).json({ error: "Invalid date" });
    }

    if (normalizedType === InventoryEntryType.PURCHASE) {
      parsedSupplierId = Number(supplierId);
      if (!supplierId || Number.isNaN(parsedSupplierId)) {
        return res.status(400).json({ error: "supplierId is required for purchases" });
      }
      parsedUnitCost = Number(unitCost);
      if (unitCost === undefined || unitCost === null || Number.isNaN(parsedUnitCost) || parsedUnitCost <= 0) {
        return res.status(400).json({ error: "unitCost must be greater than zero for purchases" });
      }
      normalizedIsPaid = typeof isPaid === "boolean" ? isPaid : true;
      normalizedTvaEligible = Boolean(tvaEligible);
    }

    let parsedPowderProductId: number | null = null;
    let parsedPowderUsed: number | null = null;
    let parsedCementProductId: number | null = null;
    let parsedCementUsed: number | null = null;
    let normalizedLaborPaid = false;
    let normalizedLaborAmount: number | null = null;
    let normalizedHelperLaborAmount: number | null = null;
    let parsedWorkerEmployeeId: number | null = null;
    let parsedHelperEmployeeId: number | null = null;
    let workerPieceRate: number | null = null;
    let helperPieceRate: number | null = null;

    const isAdmin = req.user?.role === "ADMIN";

    if (normalizedType === InventoryEntryType.PRODUCTION) {
      const overridePowderProductId =
        powderProductId === undefined || powderProductId === null || `${powderProductId}`.trim() === ""
          ? null
          : Number(powderProductId);
      const overridePowderUsed =
        powderUsed === undefined || powderUsed === null || `${powderUsed}`.trim() === ""
          ? null
          : Number(powderUsed);
      const overrideCementProductId =
        cementProductId === undefined || cementProductId === null || `${cementProductId}`.trim() === ""
          ? null
          : Number(cementProductId);
      const overrideCementUsed =
        cementUsed === undefined || cementUsed === null || `${cementUsed}`.trim() === ""
          ? null
          : Number(cementUsed);

      if (product.isManufactured) {
        const hasRecipe =
          product.productionPowderProductId &&
          product.productionPowderQuantity !== null &&
          product.productionCementProductId &&
          product.productionCementQuantity !== null;

        if (!hasRecipe && !isAdmin) {
          return res.status(400).json({
            error: "Manufactured product is missing default component configuration",
          });
        }

        // Admins can override or supply missing recipe amounts/products
        parsedPowderProductId =
          isAdmin && overridePowderProductId !== null
            ? overridePowderProductId
            : product.productionPowderProductId ?? null;
        parsedPowderUsed =
          isAdmin && overridePowderUsed !== null
            ? overridePowderUsed
            : product.productionPowderQuantity !== null
              ? product.productionPowderQuantity * parsedQuantity
              : null;
        parsedCementProductId =
          isAdmin && overrideCementProductId !== null
            ? overrideCementProductId
            : product.productionCementProductId ?? null;
        parsedCementUsed =
          isAdmin && overrideCementUsed !== null
            ? overrideCementUsed
            : product.productionCementQuantity !== null
              ? product.productionCementQuantity * parsedQuantity
              : null;
      } else {
        parsedPowderProductId = overridePowderProductId;
        parsedPowderUsed = overridePowderUsed;
        parsedCementProductId = overrideCementProductId;
        parsedCementUsed = overrideCementUsed;

        if (!isAdmin) {
          if (
            parsedPowderProductId === null ||
            parsedPowderUsed === null ||
            Number.isNaN(parsedPowderProductId) ||
            Number.isNaN(parsedPowderUsed) ||
            parsedPowderUsed <= 0
          ) {
            return res.status(400).json({
              error: "Provide powder product and quantity for production entries",
            });
          }

          if (
            parsedCementProductId === null ||
            parsedCementUsed === null ||
            Number.isNaN(parsedCementProductId) ||
            Number.isNaN(parsedCementUsed) ||
            parsedCementUsed <= 0
          ) {
            return res.status(400).json({
              error: "Provide cement product and quantity for production entries",
            });
          }
        }
      }

      const hasManualLaborAmount =
        laborAmount !== undefined && laborAmount !== null && String(laborAmount).trim() !== "";
      const hasManualHelperAmount =
        helperLaborAmount !== undefined &&
        helperLaborAmount !== null &&
        String(helperLaborAmount).trim() !== "";

      if (hasManualLaborAmount) {
        const parsed = Number(laborAmount);
        if (Number.isNaN(parsed) || parsed < 0) {
          return res.status(400).json({ error: "Worker payout must be a positive number" });
        }
        normalizedLaborAmount = parsed;
      }
      if (hasManualHelperAmount) {
        const parsed = Number(helperLaborAmount);
        if (Number.isNaN(parsed) || parsed < 0) {
          return res.status(400).json({ error: "Helper payout must be a positive number" });
        }
        normalizedHelperLaborAmount = parsed;
      }

      const laborTotal =
        (normalizedLaborAmount ?? 0) +
        (normalizedHelperLaborAmount ?? 0);
      if (typeof laborPaid === "boolean") {
        normalizedLaborPaid = laborPaid;
      } else {
        normalizedLaborPaid = laborTotal > 0 ? false : true;
      }

      const hasWorkerId =
        workerEmployeeId !== undefined &&
        workerEmployeeId !== null &&
        String(workerEmployeeId).trim() !== "";
      if (hasWorkerId) {
        const parsed = Number(workerEmployeeId);
        if (Number.isNaN(parsed)) {
          return res.status(400).json({ error: "Invalid workerEmployeeId" });
        }
        const worker = await prisma.employee.findUnique({
          where: { id: parsed },
          select: { id: true },
        });
        if (!worker) {
          return res.status(400).json({ error: "Worker employee not found" });
        }
        parsedWorkerEmployeeId = parsed;
        if (parsedProductId) {
          const workerRateRows = await prisma.$queryRaw<Array<{ rate: number | null }>>`
            SELECT "rate"
            FROM "ManufacturingPieceRate"
            WHERE "employeeId" = ${parsed}
              AND "productId" = ${parsedProductId}
              AND "isActive" = true
            LIMIT 1
          `;
          const workerRate = workerRateRows[0];
          workerPieceRate = workerRate?.rate ?? null;
        } else {
          workerPieceRate = null;
        }
      }

      const hasHelperId =
        helperEmployeeId !== undefined &&
        helperEmployeeId !== null &&
        String(helperEmployeeId).trim() !== "";
      if (hasHelperId) {
        const parsed = Number(helperEmployeeId);
        if (Number.isNaN(parsed)) {
          return res.status(400).json({ error: "Invalid helperEmployeeId" });
        }
        const helper = await prisma.employee.findUnique({
          where: { id: parsed },
          select: { id: true },
        });
        if (!helper) {
          return res.status(400).json({ error: "Helper employee not found" });
        }
        parsedHelperEmployeeId = parsed;
        if (parsedProductId) {
          const helperRateRows = await prisma.$queryRaw<
            Array<{ rate: number; helperRate: number | null }>
          >`
            SELECT "rate", "helperRate"
            FROM "ManufacturingPieceRate"
            WHERE "employeeId" = ${parsed}
              AND "productId" = ${parsedProductId}
              AND "isActive" = true
            LIMIT 1
          `;
          const helperRateRecord = helperRateRows[0];
          helperPieceRate =
            helperRateRecord?.helperRate ??
            helperRateRecord?.rate ??
            null;
        } else {
          helperPieceRate = null;
        }
      }

      if (!hasManualLaborAmount && normalizedLaborAmount === null) {
        if (workerPieceRate !== null) {
          normalizedLaborAmount = workerPieceRate * parsedQuantity;
        } else if (product.pieceworkRate !== null && product.pieceworkRate !== undefined) {
          normalizedLaborAmount = product.pieceworkRate * parsedQuantity;
        }
      }
      if (!hasManualHelperAmount && normalizedHelperLaborAmount === null) {
        if (helperPieceRate !== null) {
          normalizedHelperLaborAmount = helperPieceRate * parsedQuantity;
        } else if (
          product.helperPieceworkRate !== null &&
          product.helperPieceworkRate !== undefined
        ) {
          normalizedHelperLaborAmount = product.helperPieceworkRate * parsedQuantity;
        }
      }
    }

    const normalizedProductionSite: string | null = null;

    const normalizedNotes =
      typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null;

    const entry = await prisma.$transaction(async (tx) => {
      const inventoryNumber = await requireNextInventoryNumber(tx, normalizedType, trimmedInventoryNo);
      const created = await tx.inventoryEntry.create({
        data: {
          inventoryNo: inventoryNumber,
          entryDate: parsedEntryDate,
          type: normalizedType,
          supplierId: parsedSupplierId,
          productId: parsedProductId,
          quantity: parsedQuantity,
          unitCost: parsedUnitCost,
          totalCost:
            normalizedType === InventoryEntryType.PURCHASE && parsedUnitCost !== null
              ? parsedUnitCost * parsedQuantity
              : null,
          isPaid: normalizedType === InventoryEntryType.PURCHASE ? normalizedIsPaid : true,
          powderUsed: parsedPowderUsed,
          powderProductId: parsedPowderProductId,
          cementUsed: parsedCementUsed,
          cementProductId: parsedCementProductId,
          notes: normalizedNotes,
          laborPaid: normalizedType === InventoryEntryType.PRODUCTION ? normalizedLaborPaid : true,
          laborAmount: normalizedType === InventoryEntryType.PRODUCTION ? normalizedLaborAmount : null,
          helperLaborAmount:
            normalizedType === InventoryEntryType.PRODUCTION ? normalizedHelperLaborAmount : null,
          workerEmployeeId:
            normalizedType === InventoryEntryType.PRODUCTION ? parsedWorkerEmployeeId : null,
          helperEmployeeId:
            normalizedType === InventoryEntryType.PRODUCTION ? parsedHelperEmployeeId : null,
          productionSite: normalizedType === InventoryEntryType.PRODUCTION ? normalizedProductionSite : null,
        } as any,
        include: inventoryInclude,
      });

      await tx.$executeRaw`
        UPDATE "InventoryEntry"
        SET "tvaEligible" = ${normalizedType === InventoryEntryType.PURCHASE ? normalizedTvaEligible : false}
        WHERE "id" = ${created.id}
      `;

      await tx.product.update({
        where: { id: parsedProductId },
        data: { stockQty: { increment: parsedQuantity } },
      });

      await tx.stockMovement.create({
        data: {
          productId: parsedProductId,
          quantity: parsedQuantity,
          type:
            normalizedType === InventoryEntryType.PURCHASE
              ? StockMovementType.PURCHASE
              : StockMovementType.PRODUCTION_OUTPUT,
          inventoryEntryId: created.id,
          date: parsedEntryDate,
        },
      });

      if (normalizedType === InventoryEntryType.PRODUCTION) {
        if (parsedPowderProductId !== null && parsedPowderUsed !== null) {
          await tx.product.update({
            where: { id: parsedPowderProductId },
            data: { stockQty: { decrement: parsedPowderUsed } },
          });
          await tx.stockMovement.create({
            data: {
              productId: parsedPowderProductId,
              quantity: -parsedPowderUsed,
              type: StockMovementType.PRODUCTION_CONSUMPTION,
              inventoryEntryId: created.id,
              date: parsedEntryDate,
            },
          });
        }

        if (parsedCementProductId !== null && parsedCementUsed !== null) {
          await tx.product.update({
            where: { id: parsedCementProductId },
            data: { stockQty: { decrement: parsedCementUsed } },
          });
          await tx.stockMovement.create({
            data: {
              productId: parsedCementProductId,
              quantity: -parsedCementUsed,
              type: StockMovementType.PRODUCTION_CONSUMPTION,
              inventoryEntryId: created.id,
              date: parsedEntryDate,
            },
          });
        }
      }

      return created;
    });

    await logAudit({
      action: "INVENTORY_ENTRY_CREATED",
      entityType: "inventoryEntry",
      entityId: entry.id,
      description: `${entry.inventoryNo} (${normalizedType}) recorded for product ${entry.productId}`,
      metadata: {
        type: normalizedType,
        quantity: entry.quantity,
        supplierId: entry.supplierId,
        laborPaid: entry.laborPaid,
        laborAmount: entry.laborAmount,
        helperLaborAmount: entry.helperLaborAmount,
        workerEmployeeId: entry.workerEmployeeId,
        helperEmployeeId: entry.helperEmployeeId,
        productionSite: entry.productionSite,
      },
    });

    res.status(201).json(entry);
  } catch (err: any) {
    if (err instanceof InventoryNumberValidationError) {
      return res.status(err.status).json(
        err.expectedNext
          ? { error: err.message, expectedNext: err.expectedNext }
          : { error: err.message },
      );
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to create inventory entry" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const entryId = Number(req.params.id);
    if (Number.isNaN(entryId)) {
      return res.status(400).json({ error: "Invalid entry id" });
    }

    const existing = await prisma.inventoryEntry.findUnique({
      where: { id: entryId },
      include: inventoryInclude,
    });

    if (!existing) {
      return res.status(404).json({ error: "Entry not found" });
    }

    if (existing.type !== InventoryEntryType.PRODUCTION) {
      return res.status(400).json({ error: "Only production entries can be modified" });
    }

    const {
      productId,
      quantity,
      date,
      notes,
      powderProductId,
      powderUsed,
      cementProductId,
      cementUsed,
      laborPaid,
      laborAmount,
      helperLaborAmount,
      workerEmployeeId,
      helperEmployeeId,
    } = req.body ?? {};

    const parsedProductId = Number(productId ?? existing.productId);
    const parsedQuantity = Number(quantity ?? existing.quantity);

    if (Number.isNaN(parsedProductId)) {
      return res.status(400).json({ error: "productId is required" });
    }
    if (Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ error: "quantity must be greater than zero" });
    }

    const parsedEntryDateRaw = date ? new Date(date) : existing.entryDate ?? existing.createdAt;
    const parsedEntryDate = new Date(parsedEntryDateRaw);
    if (Number.isNaN(parsedEntryDate.getTime())) {
      return res.status(400).json({ error: "Invalid date supplied" });
    }

    const product = await prisma.product.findUnique({
      where: { id: parsedProductId },
      select: {
        id: true,
        isManufactured: true,
        productionPowderProductId: true,
        productionPowderQuantity: true,
        productionCementProductId: true,
        productionCementQuantity: true,
      },
    });

    if (!product) {
      return res.status(400).json({ error: "Product not found" });
    }
    const isAdmin = req.user?.role === "ADMIN";
    if (!product.isManufactured) {
      return res.status(400).json({ error: "Only manufactured products are supported for production entries" });
    }
    const hasRecipe =
      product.productionPowderProductId &&
      product.productionPowderQuantity !== null &&
      product.productionCementProductId &&
      product.productionCementQuantity !== null;
    if (!hasRecipe && !isAdmin) {
      return res
        .status(400)
        .json({ error: "Manufactured product is missing its powder/cement configuration" });
    }

    const normalizedProductionSite = existing.productionSite;

    const normalizedNotes =
      typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null;

    const normalizedLaborAmount =
      laborAmount === undefined || laborAmount === null
        ? existing.laborAmount
        : Number(laborAmount);
    if (normalizedLaborAmount !== null && Number.isNaN(normalizedLaborAmount)) {
      return res.status(400).json({ error: "laborAmount must be numeric" });
    }

    const normalizedHelperLaborAmount =
      helperLaborAmount === undefined || helperLaborAmount === null
        ? existing.helperLaborAmount
        : Number(helperLaborAmount);
    if (normalizedHelperLaborAmount !== null && Number.isNaN(normalizedHelperLaborAmount)) {
      return res.status(400).json({ error: "helperLaborAmount must be numeric" });
    }

    const laborTotal = (normalizedLaborAmount ?? 0) + (normalizedHelperLaborAmount ?? 0);
    let normalizedLaborPaid =
      typeof laborPaid === "boolean" ? laborPaid : existing.laborPaid ?? false;
    if (typeof laborPaid !== "boolean") {
      normalizedLaborPaid = laborTotal > 0 ? existing.laborPaid ?? false : true;
    }

    let parsedWorkerEmployeeId: number | null =
      workerEmployeeId === undefined ? existing.workerEmployeeId : Number(workerEmployeeId);
    if (parsedWorkerEmployeeId !== null && Number.isNaN(parsedWorkerEmployeeId)) {
      return res.status(400).json({ error: "Invalid workerEmployeeId" });
    }
    if (parsedWorkerEmployeeId !== null) {
      const worker = await prisma.employee.findUnique({
        where: { id: parsedWorkerEmployeeId },
        select: { id: true },
      });
      if (!worker) {
        return res.status(400).json({ error: "Worker employee not found" });
      }
    }

    let parsedHelperEmployeeId: number | null =
      helperEmployeeId === undefined ? existing.helperEmployeeId : Number(helperEmployeeId);
    if (parsedHelperEmployeeId !== null && Number.isNaN(parsedHelperEmployeeId)) {
      return res.status(400).json({ error: "Invalid helperEmployeeId" });
    }
    if (parsedHelperEmployeeId !== null) {
      const helper = await prisma.employee.findUnique({
        where: { id: parsedHelperEmployeeId },
        select: { id: true },
      });
      if (!helper) {
        return res.status(400).json({ error: "Helper employee not found" });
      }
    }

    const overridePowderProductId =
      powderProductId === undefined || powderProductId === null || `${powderProductId}`.trim() === ""
        ? null
        : Number(powderProductId);
    const overridePowderUsed =
      powderUsed === undefined || powderUsed === null || `${powderUsed}`.trim() === ""
        ? null
        : Number(powderUsed);
    const overrideCementProductId =
      cementProductId === undefined || cementProductId === null || `${cementProductId}`.trim() === ""
        ? null
        : Number(cementProductId);
    const overrideCementUsed =
      cementUsed === undefined || cementUsed === null || `${cementUsed}`.trim() === ""
        ? null
        : Number(cementUsed);

    const parsedPowderProductId =
      isAdmin && overridePowderProductId !== null
        ? overridePowderProductId
        : product.productionPowderProductId ?? existing.powderProductId ?? null;
    const parsedPowderUsed =
      isAdmin && overridePowderUsed !== null
        ? overridePowderUsed
        : product.productionPowderQuantity !== null && product.productionPowderQuantity !== undefined
          ? product.productionPowderQuantity * parsedQuantity
          : existing.powderUsed ?? null;

    const parsedCementProductId =
      isAdmin && overrideCementProductId !== null
        ? overrideCementProductId
        : product.productionCementProductId ?? existing.cementProductId ?? null;
    const parsedCementUsed =
      isAdmin && overrideCementUsed !== null
        ? overrideCementUsed
        : product.productionCementQuantity !== null && product.productionCementQuantity !== undefined
          ? product.productionCementQuantity * parsedQuantity
          : existing.cementUsed ?? null;

    const updated = await prisma.$transaction(async (tx) => {
      if (existing.quantity > 0) {
        await tx.product.update({
          where: { id: existing.productId },
          data: { stockQty: { decrement: existing.quantity } },
        });
      }
      if (existing.powderProductId && existing.powderUsed) {
        await tx.product.update({
          where: { id: existing.powderProductId },
          data: { stockQty: { increment: existing.powderUsed } },
        });
      }
      if (existing.cementProductId && existing.cementUsed) {
        await tx.product.update({
          where: { id: existing.cementProductId },
          data: { stockQty: { increment: existing.cementUsed } },
        });
      }

      await tx.stockMovement.deleteMany({ where: { inventoryEntryId: entryId } });

      const saved = await tx.inventoryEntry.update({
        where: { id: entryId },
        data: {
          productId: parsedProductId,
          quantity: parsedQuantity,
          inventoryNo: existing.inventoryNo,
          entryDate: parsedEntryDate,
          productionSite: normalizedProductionSite,
          notes: normalizedNotes,
          powderProductId: parsedPowderProductId,
          powderUsed: parsedPowderUsed,
          cementProductId: parsedCementProductId,
          cementUsed: parsedCementUsed,
          laborPaid: normalizedLaborPaid,
          laborAmount: normalizedLaborAmount,
          helperLaborAmount: normalizedHelperLaborAmount,
          workerEmployeeId: parsedWorkerEmployeeId,
          helperEmployeeId: parsedHelperEmployeeId,
        },
        include: inventoryInclude,
      });

      await tx.product.update({
        where: { id: parsedProductId },
        data: { stockQty: { increment: parsedQuantity } },
      });

      await tx.stockMovement.create({
        data: {
          productId: parsedProductId,
          quantity: parsedQuantity,
          type: StockMovementType.PRODUCTION_OUTPUT,
          inventoryEntryId: entryId,
          date: parsedEntryDate,
        },
      });

      if (parsedPowderProductId && parsedPowderUsed) {
        await tx.product.update({
          where: { id: parsedPowderProductId },
          data: { stockQty: { decrement: parsedPowderUsed } },
        });
        await tx.stockMovement.create({
          data: {
            productId: parsedPowderProductId,
            quantity: -parsedPowderUsed,
            type: StockMovementType.PRODUCTION_CONSUMPTION,
            inventoryEntryId: entryId,
            date: parsedEntryDate,
          },
        });
      }

      if (parsedCementProductId && parsedCementUsed) {
        await tx.product.update({
          where: { id: parsedCementProductId },
          data: { stockQty: { decrement: parsedCementUsed } },
        });
        await tx.stockMovement.create({
          data: {
            productId: parsedCementProductId,
            quantity: -parsedCementUsed,
            type: StockMovementType.PRODUCTION_CONSUMPTION,
            inventoryEntryId: entryId,
            date: parsedEntryDate,
          },
        });
      }

      return saved;
    });

    await logAudit({
      action: "INVENTORY_ENTRY_UPDATED",
      entityType: "inventoryEntry",
      entityId: entryId,
      description: `Production entry ${entryId} updated`,
      user: req.user?.email ?? req.user?.name ?? null,
      metadata: {
        productId: parsedProductId,
        quantity: parsedQuantity,
      },
    });

    res.json(updated);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update inventory entry" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid inventory entry id" });
    }

    await prisma.$transaction(async (tx) => {
      const entry = await tx.inventoryEntry.findUnique({
        where: { id },
        include: {
          stockMoves: true,
        },
      });

      if (!entry) {
        throw new Error("NOT_FOUND");
      }

      await tx.stockMovement.deleteMany({ where: { inventoryEntryId: id } });

      await tx.product.update({
        where: { id: entry.productId },
        data: { stockQty: { decrement: entry.quantity } },
      });

      if (entry.powderProductId !== null && entry.powderUsed) {
        await tx.product.update({
          where: { id: entry.powderProductId },
          data: { stockQty: { increment: entry.powderUsed } },
        });
      }

      if (entry.cementProductId !== null && entry.cementUsed) {
        await tx.product.update({
          where: { id: entry.cementProductId },
          data: { stockQty: { increment: entry.cementUsed } },
        });
      }

      await tx.inventoryEntry.delete({ where: { id } });
    });

    await logAudit({
      action: "INVENTORY_ENTRY_DELETED",
      entityType: "inventoryEntry",
      entityId: id,
      description: `Inventory entry ${id} deleted`,
    });

    res.json({ message: "Inventory entry deleted" });
  } catch (err: any) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Inventory entry not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to delete inventory entry" });
  }
});

router.get("/payables", async (_req, res) => {
  try {
    const payables = await prisma.inventoryEntry.findMany({
      where: {
        type: InventoryEntryType.PURCHASE,
        isPaid: false,
      } as any,
      include: {
        supplier: true,
        product: true,
      },
      orderBy: { entryDate: "desc" } as any,
    });

    // Sum of linked inventory payments (when the table/column exists)
    const paidMap = new Map<number, number>();
    try {
      const linkSums = await prisma.inventoryPayment.groupBy({
        by: ["inventoryEntryId"],
        _sum: { amount: true },
      });
      linkSums.forEach((r) => paidMap.set(r.inventoryEntryId, Number(r._sum.amount ?? 0)));
    } catch {
      // If the table doesn't exist yet (migration not applied), just fall back to amountPaid on entry
    }

    const enriched = payables
      .map((entry) => {
        const total = computeInventoryAmount(entry);
        const paid = Math.max(Number(entry.amountPaid ?? 0), paidMap.get(entry.id) ?? 0);
        const outstanding = Math.max(total - paid, 0);
        return { ...entry, totalCost: total, amountPaid: paid, outstanding };
      })
      .filter((entry) => entry.outstanding > 0);

    const totalDue = enriched.reduce((sum, entry) => sum + entry.outstanding, 0);

    res.json({ totalDue, entries: enriched });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch outstanding purchases" });
  }
});

router.post("/:id/mark-paid", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid inventory entry id" });
    }

    const entry = await prisma.inventoryEntry.findUnique({ where: { id } });
    if (!entry) {
      return res.status(404).json({ error: "Inventory entry not found" });
    }
    if (entry.type !== InventoryEntryType.PURCHASE) {
      return res.status(400).json({ error: "Only purchase entries can be marked as paid" });
    }
    if ((entry as any).isPaid) {
      return res.status(400).json({ error: "Entry is already marked as paid" });
    }

    const updated = await prisma.inventoryEntry.update({
      where: { id },
      data: { isPaid: true } as any,
      include: inventoryInclude,
    });

    await logAudit({
      action: "INVENTORY_ENTRY_MARKED_PAID",
      entityType: "inventoryEntry",
      entityId: updated.id,
      description: `Inventory entry ${updated.id} marked as paid`,
      metadata: {
        supplierId: updated.supplierId,
        productId: updated.productId,
        totalCost: updated.totalCost !== null && updated.totalCost !== undefined ? Number(updated.totalCost) : null,
      },
    });

    res.json(updated);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to mark purchase as paid" });
  }
});

router.get("/production-payables", async (_req, res) => {
  try {
    const entries = await prisma.inventoryEntry.findMany({
      where: {
        type: InventoryEntryType.PRODUCTION,
        laborPaid: false,
        OR: [
          { laborAmount: { not: null } },
          { helperLaborAmount: { not: null } },
        ],
      } as any,
      include: inventoryInclude,
      orderBy: { entryDate: "asc" } as any,
    });

    const totalDue = entries.reduce((sum, entry) => {
      const workerPortion = entry.laborAmount ?? 0;
      const helperPortion = entry.helperLaborAmount ?? 0;
      return sum + workerPortion + helperPortion;
    }, 0);

    res.json({ totalDue, entries });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch production payables" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid inventory entry id" });
    }
    const entry = await prisma.inventoryEntry.findUnique({
      where: { id },
      include: {
        ...inventoryInclude,
        stockMoves: true,
      },
    });
    if (!entry) {
      return res.status(404).json({ error: "Inventory entry not found" });
    }
    res.json(entry);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch inventory entry" });
  }
});

router.get("/production-payables/weekly-summary", async (req, res) => {
  try {
    const startParam = req.query.start as string | undefined;
    const endParam = req.query.end as string | undefined;

    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diffToMonday = (day + 6) % 7;
    const defaultStart = new Date(now);
    defaultStart.setDate(now.getDate() - diffToMonday);
    defaultStart.setHours(0, 0, 0, 0);
    const defaultEnd = new Date(defaultStart);
    defaultEnd.setDate(defaultStart.getDate() + 7);
    defaultEnd.setMilliseconds(-1);

    const startDate = startParam ? new Date(startParam) : defaultStart;
    const endDate = endParam ? new Date(endParam) : defaultEnd;
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    const entries = await prisma.inventoryEntry.findMany({
      where: {
        type: InventoryEntryType.PRODUCTION,
        laborPaid: false,
        entryDate: {
          gte: startDate,
          lte: endDate,
        },
        OR: [{ laborAmount: { not: null } }, { helperLaborAmount: { not: null } }],
      },
      select: {
        id: true,
        entryDate: true,
        createdAt: true,
        laborAmount: true,
        helperLaborAmount: true,
        productId: true,
        workerEmployeeId: true,
        helperEmployeeId: true,
        workerEmployee: { select: { id: true, name: true } },
        helperEmployee: { select: { id: true, name: true } },
      },
    });

    type WorkerKey = string;
    const totals: Record<
      WorkerKey,
      { id: number | null; name: string; amount: number; entries: Array<{ entryId: number; role: string; amount: number; date: Date; productId: number }> }
    > = {};

    entries.forEach((entry) => {
      const workerAmount = entry.laborAmount ?? 0;
      const helperAmount = entry.helperLaborAmount ?? 0;
      if (workerAmount > 0) {
        const key = `w-${entry.workerEmployeeId ?? "unknown"}`;
        if (!totals[key]) {
          totals[key] = {
            id: entry.workerEmployee?.id ?? null,
            name: entry.workerEmployee?.name ?? "Worker",
            amount: 0,
            entries: [],
          };
        }
        totals[key].amount += workerAmount;
        totals[key].entries.push({
          entryId: entry.id,
          role: "worker",
          amount: workerAmount,
          date: (entry.entryDate ?? entry.createdAt) as Date,
          productId: entry.productId,
        });
      }
      if (helperAmount > 0) {
        const key = `h-${entry.helperEmployeeId ?? "unknown"}`;
        if (!totals[key]) {
          totals[key] = {
            id: entry.helperEmployee?.id ?? null,
            name: entry.helperEmployee?.name ?? "Helper",
            amount: 0,
            entries: [],
          };
        }
        totals[key].amount += helperAmount;
        totals[key].entries.push({
          entryId: entry.id,
          role: "helper",
          amount: helperAmount,
          date: (entry.entryDate ?? entry.createdAt) as Date,
          productId: entry.productId,
        });
      }
    });

    res.json({
      start: startDate,
      end: endDate,
      workers: Object.values(totals).sort((a, b) => b.amount - a.amount),
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to compute weekly payroll summary" });
  }
});

router.post("/:id/mark-labor-paid", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid inventory entry id" });
    }

    const paidAtInput = req.body?.paidAt;
    const paidAt = paidAtInput ? new Date(paidAtInput) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      return res.status(400).json({ error: "Invalid paidAt date" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const entry = await tx.inventoryEntry.findUnique({
        where: { id },
        select: {
          id: true,
          type: true,
          laborPaid: true,
          laborAmount: true,
          helperLaborAmount: true,
        },
      });

      if (!entry) {
        throw new Error("NOT_FOUND");
      }
      if (entry.type !== InventoryEntryType.PRODUCTION) {
        throw new Error("INVALID_TYPE");
      }
      const workerAmount = entry.laborAmount ?? 0;
      const helperAmount = entry.helperLaborAmount ?? 0;
      const payoutTotal = workerAmount + helperAmount;
      if (entry.laborPaid) {
        throw new Error("ALREADY_PAID");
      }
      if (payoutTotal <= 0) {
        throw new Error("NO_PAYOUT");
      }

      const [updatedEntry] = await Promise.all([
        tx.inventoryEntry.update({
          where: { id },
          data: {
            laborPaid: true,
            laborPaidAt: paidAt,
          },
          include: inventoryInclude,
        }),
        tx.payment.create({
          data: {
            amount: payoutTotal,
            type: PaymentType.PAYROLL_PIECEWORK,
            description: `Manufacturing payout for entry ${id}`,
            reference: `manufacturing-${id}`,
          },
        }),
      ]);

      return updatedEntry;
    });

    await logAudit({
      action: "PRODUCTION_LABOR_MARKED_PAID",
      entityType: "inventoryEntry",
      entityId: updated.id,
      description: `Production entry ${updated.id} labor marked as paid`,
      metadata: {
        paidAt: paidAt.toISOString(),
        laborAmount: updated.laborAmount,
        helperLaborAmount: updated.helperLaborAmount,
      },
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof Error) {
      if (err.message === "NOT_FOUND") {
        return res.status(404).json({ error: "Inventory entry not found" });
      }
      if (err.message === "INVALID_TYPE") {
        return res.status(400).json({ error: "Entry is not a production run" });
      }
      if (err.message === "ALREADY_PAID") {
        return res.status(400).json({ error: "Labor already marked as paid" });
      }
      if (err.message === "NO_PAYOUT") {
        return res.status(400).json({ error: "No outstanding labor for this entry" });
      }
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to mark labor as paid" });
  }
});

export default router;
