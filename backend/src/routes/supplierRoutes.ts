import { Router } from "express";
import prisma from "../prismaClient";
import { logAudit } from "../utils/auditLogger";
import { InventoryEntryType, UserRole } from "@prisma/client";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const [suppliers, unpaidEntries] = await Promise.all([
      prisma.supplier.findMany({
        orderBy: { name: "asc" },
        include: {
          manualBalanceUpdatedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.inventoryEntry.findMany({
        where: {
          supplierId: { not: null },
          type: InventoryEntryType.PURCHASE,
          isPaid: false,
        },
        select: {
          supplierId: true,
          totalCost: true,
          unitCost: true,
          quantity: true,
        },
      }),
    ]);

    const payableMap = new Map<number, number>();
    unpaidEntries.forEach((entry) => {
      if (entry.supplierId === null) return;
      const amount =
        entry.totalCost !== null && entry.totalCost !== undefined
          ? Number(entry.totalCost)
          : Number(entry.unitCost ?? 0) * Number(entry.quantity ?? 0);
      if (!payableMap.has(entry.supplierId)) {
        payableMap.set(entry.supplierId, 0);
      }
      payableMap.set(entry.supplierId, (payableMap.get(entry.supplierId) ?? 0) + amount);
    });

    const response = suppliers.map((supplier) => ({
      ...supplier,
      computedBalance:
        (supplier.manualBalanceOverride ?? 0) + (payableMap.get(supplier.id) ?? 0),
    }));

    res.json(response);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch suppliers" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, contact, notes } = req.body;

    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (!normalizedName) {
      return res.status(400).json({ error: "name is required" });
    }
    const normalizedContact =
      typeof contact === "string" && contact.trim().length > 0 ? contact.trim() : null;
    const normalizedNotes =
      typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null;

    const supplier = await prisma.supplier.create({
      data: {
        name: normalizedName,
        contact: normalizedContact,
        notes: normalizedNotes,
      },
      include: {
        manualBalanceUpdatedBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.status(201).json(supplier);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to create supplier" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, contact, notes } = req.body;

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid supplier id" });
    }

    const updateData: Record<string, string | null> = {};

    if (name !== undefined) {
      const normalizedName = typeof name === "string" ? name.trim() : "";
      if (!normalizedName) {
        return res.status(400).json({ error: "name is required" });
      }
      updateData.name = normalizedName;
    }

    if (contact !== undefined) {
      const normalizedContact =
        typeof contact === "string" && contact.trim().length > 0 ? contact.trim() : null;
      updateData.contact = normalizedContact;
    }

    if (notes !== undefined) {
      const normalizedNotes =
        typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null;
      updateData.notes = normalizedNotes;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No fields provided to update" });
    }

    const supplier = await prisma.supplier.update({
      where: { id },
      data: updateData,
      include: {
        manualBalanceUpdatedBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.json(supplier);
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Supplier not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update supplier" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid supplier id" });
    }

    const entryCount = await prisma.inventoryEntry.count({ where: { supplierId: id } });
    if (entryCount > 0) {
      return res
        .status(400)
        .json({ error: "Cannot delete a supplier linked to inventory entries" });
    }

    await prisma.supplier.delete({ where: { id } });
    res.json({ message: "Supplier deleted" });
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Supplier not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to delete supplier" });
  }
});

router.post("/:id/manual-balance", async (req, res) => {
  try {
    if (req.user?.role !== UserRole.ADMIN) {
      return res.status(403).json({ error: "Only admins can override balances" });
    }

    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid supplier id" });
    }

    const { amount, note } = req.body ?? {};
    let normalizedAmount: number | null = null;
    if (amount !== undefined && amount !== null && `${amount}`.trim().length > 0) {
      const parsed = Number(amount);
      if (!Number.isFinite(parsed)) {
        return res.status(400).json({ error: "amount must be a valid number" });
      }
      normalizedAmount = parsed;
    }

    const normalizedNote =
      typeof note === "string" && note.trim().length > 0 ? note.trim() : null;

    const supplier = await prisma.supplier.update({
      where: { id },
      data: {
        manualBalanceOverride: normalizedAmount,
        manualBalanceNote: normalizedAmount !== null ? normalizedNote : null,
        manualBalanceUpdatedAt: normalizedAmount !== null ? new Date() : null,
        manualBalanceUpdatedById: normalizedAmount !== null ? req.user?.id ?? null : null,
      },
      include: {
        manualBalanceUpdatedBy: { select: { id: true, name: true, email: true } },
      },
    });

    await logAudit({
      action: normalizedAmount !== null ? "SUPPLIER_BALANCE_OVERRIDE" : "SUPPLIER_BALANCE_CLEAR",
      entityType: "SUPPLIER",
      entityId: id,
      description:
        normalizedAmount !== null
          ? `Set supplier manual balance to ${normalizedAmount}`
          : "Cleared supplier manual balance override",
      user: req.user?.email ?? null,
      metadata: {
        amount: normalizedAmount,
        note: normalizedNote,
      },
    });

    res.json(supplier);
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Supplier not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update manual balance" });
  }
});

export default router;
