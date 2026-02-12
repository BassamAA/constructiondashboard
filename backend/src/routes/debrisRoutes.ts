import { Router } from "express";
import { DebrisStatus, PaymentType, StockMovementType, Prisma } from "@prisma/client";
import prisma from "../prismaClient";
import { requirePermission } from "../middleware/auth";

const router = Router();

const debrisInclude = {
  customer: true,
  supplier: true,
  removalPayment: {
    include: {
      supplier: true,
    },
  },
};

router.get("/", async (req, res) => {
  try {
    const { status, customerId, paid } = req.query;
    const where: any = {};
    if (status) {
      const normalized = String(status).toUpperCase();
      if (!Object.values(DebrisStatus).includes(normalized as DebrisStatus)) {
        return res.status(400).json({ error: "Invalid status filter" });
      }
      where.status = normalized;
    }
    if (customerId) {
      const parsed = Number(customerId);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ error: "Invalid customerId" });
      }
      where.customerId = parsed;
    }
    if (paid !== undefined) {
      const normalizedPaid = String(paid).toLowerCase();
      if (normalizedPaid === "true" || normalizedPaid === "1") {
        where.removalPaymentId = { not: null };
      } else if (normalizedPaid === "false" || normalizedPaid === "0") {
        where.removalPaymentId = null;
      } else {
        return res.status(400).json({ error: "Invalid paid filter" });
      }
    }

    const entries = await prisma.debrisEntry.findMany({
      where,
      include: debrisInclude,
      orderBy: { date: "desc" },
    });
    res.json(entries);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch debris entries" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      date,
      supplierId,
      volume,
      amount,
      notes,
      description,
      category,
      reference,
    } = req.body;

    const parsedVolume = Number(volume);
    if (!volume || Number.isNaN(parsedVolume) || parsedVolume <= 0) {
      return res.status(400).json({ error: "volume must be greater than zero" });
    }

    const parsedAmount = Number(amount ?? 0);
    if (Number.isNaN(parsedAmount) || parsedAmount < 0) {
      return res.status(400).json({ error: "amount must be zero or a positive number" });
    }

    if (supplierId === undefined || supplierId === null || supplierId === "") {
      return res.status(400).json({ error: "supplierId is required" });
    }
    const parsedSupplierId = Number(supplierId);
    if (Number.isNaN(parsedSupplierId)) {
      return res.status(400).json({ error: "Invalid supplierId" });
    }

    const debrisProduct = await prisma.product.findFirst({
      where: { name: { equals: "Debris", mode: "insensitive" } },
      select: { id: true, stockQty: true },
    });

    if (!debrisProduct) {
      return res.status(400).json({ error: "Debris product not found" });
    }

    if (Number(debrisProduct.stockQty) < parsedVolume) {
      return res.status(400).json({ error: "Not enough debris stock to remove the requested volume" });
    }

    const removalDate = date ? new Date(date) : new Date();
    const trimmedNotes = typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null;
    const trimmedDescription =
      typeof description === "string" && description.trim().length > 0 ? description.trim() : null;
    const trimmedCategory =
      typeof category === "string" && category.trim().length > 0 ? category.trim() : null;
    const trimmedReference =
      typeof reference === "string" && reference.trim().length > 0 ? reference.trim() : null;

    const result = await prisma.$transaction(async (tx) => {
      const entry = await tx.debrisEntry.create({
        data: {
          date: removalDate,
          volume: parsedVolume,
          supplierId: parsedSupplierId,
          status: parsedAmount > 0 ? DebrisStatus.REMOVED : DebrisStatus.PENDING,
          notes: trimmedNotes,
          removalCost: parsedAmount > 0 ? parsedAmount : null,
          removalDate: parsedAmount > 0 ? removalDate : null,
        },
      });

      let payment = null;
      if (parsedAmount > 0) {
        payment = await tx.payment.create({
          data: {
            date: removalDate,
            amount: parsedAmount,
            type: PaymentType.DEBRIS_REMOVAL,
            description: trimmedDescription,
            category: trimmedCategory,
            reference: trimmedReference,
            supplierId: parsedSupplierId,
            debrisRemoval: {
              connect: { id: entry.id },
            },
          },
          include: {
            supplier: true,
          },
        });

        await tx.debrisEntry.update({
          where: { id: entry.id },
          data: {
            removalPaymentId: payment.id,
            removalCost: parsedAmount,
            removalDate,
            status: DebrisStatus.REMOVED,
          },
        });
      }

      await tx.product.update({
        where: { id: debrisProduct.id },
        data: {
          stockQty: { decrement: parsedVolume },
        },
      });

      await tx.stockMovement.create({
        data: {
          productId: debrisProduct.id,
          quantity: -parsedVolume,
          type: StockMovementType.SALE,
        },
      });

      const freshEntry = await tx.debrisEntry.findUnique({
        where: { id: entry.id },
        include: debrisInclude,
      });

      return { entry: freshEntry, payment };
    });

    res.status(201).json(result.entry);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to log debris removal" });
  }
});

router.put("/:id", requirePermission("debris:edit"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid debris entry id" });
    }

    const existing = await prisma.debrisEntry.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ error: "Debris entry not found" });
    }
    if (existing.removalPaymentId) {
      return res
        .status(400)
        .json({ error: "Paid removals cannot be edited. Mark it unpaid first." });
    }

    const { date, supplierId, volume, amount, notes } = req.body ?? {};
    if (
      date === undefined &&
      supplierId === undefined &&
      volume === undefined &&
      amount === undefined &&
      notes === undefined
    ) {
      return res.status(400).json({ error: "Provide at least one field to update" });
    }

    const updateData: Prisma.DebrisEntryUpdateInput = {};

    if (date !== undefined) {
      if (!date) {
        updateData.date = new Date();
      } else {
        const parsedDate = new Date(date);
        if (Number.isNaN(parsedDate.getTime())) {
          return res.status(400).json({ error: "Invalid date value" });
        }
        updateData.date = parsedDate;
      }
    }

    if (supplierId !== undefined) {
      if (supplierId === null || `${supplierId}`.trim() === "") {
        updateData.supplier = { disconnect: true };
      } else {
        const parsedSupplier = Number(supplierId);
        if (Number.isNaN(parsedSupplier)) {
          return res.status(400).json({ error: "Invalid supplierId" });
        }
        const supplierExists = await prisma.supplier.findUnique({
          where: { id: parsedSupplier },
          select: { id: true },
        });
        if (!supplierExists) {
          return res.status(400).json({ error: "Supplier not found" });
        }
        updateData.supplier = { connect: { id: parsedSupplier } };
      }
    }

    let parsedVolume: number | null = null;
    if (volume !== undefined) {
      const nextVolume = Number(volume);
      if (Number.isNaN(nextVolume) || nextVolume <= 0) {
        return res.status(400).json({ error: "volume must be greater than zero" });
      }
      parsedVolume = nextVolume;
      updateData.volume = nextVolume;
    }

    if (amount !== undefined) {
      if (amount === null || `${amount}`.trim() === "") {
        updateData.removalCost = null;
      } else {
        const parsedAmount = Number(amount);
        if (Number.isNaN(parsedAmount) || parsedAmount < 0) {
          return res.status(400).json({ error: "Enter a valid removal cost" });
        }
        updateData.removalCost = parsedAmount > 0 ? parsedAmount : null;
      }
    }

    if (notes !== undefined) {
      updateData.notes =
        typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null;
    }

    let volumeDelta = 0;
    if (parsedVolume !== null) {
      volumeDelta = parsedVolume - existing.volume;
    }

    let debrisProduct:
      | {
          id: number;
          stockQty: Prisma.Decimal | number;
        }
      | null = null;
    if (volumeDelta !== 0) {
      debrisProduct = await prisma.product.findFirst({
        where: { name: { equals: "Debris", mode: "insensitive" } },
        select: { id: true, stockQty: true },
      });
      if (!debrisProduct) {
        return res.status(400).json({ error: "Debris product not found" });
      }
      if (volumeDelta > 0 && Number(debrisProduct.stockQty) < volumeDelta) {
        return res.status(400).json({ error: "Not enough debris stock for this edit" });
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const saved = await tx.debrisEntry.update({
        where: { id },
        data: updateData,
        include: debrisInclude,
      });

      if (volumeDelta !== 0 && debrisProduct) {
        await tx.product.update({
          where: { id: debrisProduct.id },
          data:
            volumeDelta > 0
              ? { stockQty: { decrement: volumeDelta } }
              : { stockQty: { increment: Math.abs(volumeDelta) } },
        });
      }

      return saved;
    });

    res.json(updated);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update debris removal" });
  }
});

router.delete("/:id", requirePermission("debris:edit"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid debris entry id" });
    }

    const entry = await prisma.debrisEntry.findUnique({
      where: { id },
      include: debrisInclude,
    });
    if (!entry) {
      return res.status(404).json({ error: "Debris entry not found" });
    }

    await prisma.$transaction(async (tx) => {
      if (entry.removalPaymentId) {
        await tx.payment.delete({ where: { id: entry.removalPaymentId } });
      }
      const debrisProduct = await tx.product.findFirst({
        where: { name: { equals: "Debris", mode: "insensitive" } },
        select: { id: true },
      });
      if (debrisProduct) {
        await tx.product.update({
          where: { id: debrisProduct.id },
          data: { stockQty: { increment: entry.volume } },
        });
      }
      await tx.debrisEntry.delete({ where: { id } });
    });

    res.json({ message: "Debris removal deleted" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to delete debris removal" });
  }
});

router.post("/:id/mark-paid", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid debris entry id" });
    }

    const entry = await prisma.debrisEntry.findUnique({
      where: { id },
      include: debrisInclude,
    });
    if (!entry) {
      return res.status(404).json({ error: "Debris entry not found" });
    }
    if (entry.removalPaymentId) {
      return res.status(400).json({ error: "Removal already paid" });
    }

    const { supplierId, amount, date, description, category, reference } = req.body ?? {};

    let parsedSupplierId: number | null = entry.supplierId ?? null;
    if (parsedSupplierId === null) {
      if (supplierId === undefined || supplierId === null || `${supplierId}`.trim() === "") {
        return res.status(400).json({ error: "supplierId is required to mark removal as paid" });
      }
      const parsed = Number(supplierId);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ error: "Invalid supplierId" });
      }
      const supplierExists = await prisma.supplier.findUnique({ where: { id: parsed } });
      if (!supplierExists) {
        return res.status(400).json({ error: "Supplier not found" });
      }
      await prisma.debrisEntry.update({ where: { id }, data: { supplierId: parsed } });
      parsedSupplierId = parsed;
    }

    const parsedAmount =
      amount !== undefined && amount !== null && `${amount}`.trim() !== ""
        ? Number(amount)
        : entry.removalCost ?? null;
    if (parsedAmount === null || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "Set a valid removal cost before marking as paid" });
    }

    const paymentDate = date ? new Date(date) : new Date();
    if (Number.isNaN(paymentDate.getTime())) {
      return res.status(400).json({ error: "Invalid payment date" });
    }
    const trimmedDescription =
      typeof description === "string" && description.trim().length > 0 ? description.trim() : null;
    const trimmedCategory =
      typeof category === "string" && category.trim().length > 0 ? category.trim() : null;
    const trimmedReference =
      typeof reference === "string" && reference.trim().length > 0 ? reference.trim() : null;

    const payment = await prisma.payment.create({
      data: {
        date: paymentDate,
        amount: parsedAmount,
        type: PaymentType.DEBRIS_REMOVAL,
        description: trimmedDescription,
        category: trimmedCategory,
        reference: trimmedReference,
        supplierId: parsedSupplierId,
        debrisRemoval: {
          connect: { id },
        },
      },
      include: { supplier: true },
    });

    const updated = await prisma.debrisEntry.update({
      where: { id },
      data: {
        removalPaymentId: payment.id,
        removalCost: parsedAmount,
        removalDate: paymentDate,
        status: DebrisStatus.REMOVED,
      },
      include: debrisInclude,
    });

    res.json(updated);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to mark removal as paid" });
  }
});

router.post("/:id/mark-unpaid", requirePermission("debris:edit"), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid debris entry id" });
    }
    const entry = await prisma.debrisEntry.findUnique({
      where: { id },
      include: debrisInclude,
    });
    if (!entry) {
      return res.status(404).json({ error: "Debris entry not found" });
    }
    if (!entry.removalPaymentId) {
      return res.status(400).json({ error: "Removal is not marked as paid" });
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.debrisEntry.update({
        where: { id },
        data: {
          removalPaymentId: null,
          removalDate: null,
          status: DebrisStatus.PENDING,
        },
      });
      if (entry.removalPaymentId) {
      await tx.payment.delete({
        where: { id: entry.removalPaymentId! },
      });
      }
      return tx.debrisEntry.findUnique({ where: { id }, include: debrisInclude });
    });

    res.json(updated);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to mark removal as unpaid" });
  }
});

export default router;
