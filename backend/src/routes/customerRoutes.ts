import { Router } from "express";
import { ReceiptType, UserRole } from "@prisma/client";
import prisma from "../prismaClient";
import { logAudit } from "../utils/auditLogger";
import { requireRole } from "../middleware/auth";
import { fetchCustomerOutstandingSimple } from "../utils/customerBalances";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const [customers, outstandingMap] = await Promise.all([
      prisma.customer.findMany({
        orderBy: { name: "asc" },
        include: {
          manualBalanceUpdatedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      fetchCustomerOutstandingSimple(),
    ]);

    const response = customers.map((customer) => ({
      ...customer,
      computedBalance:
        (customer.manualBalanceOverride ?? 0) + (outstandingMap.get(customer.id) ?? 0),
    }));

    res.json(response);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch customers" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, contactName, phone, email, notes, receiptType } = req.body;

    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (!normalizedName) {
      return res.status(400).json({ error: "name is required" });
    }

    const normalizedReceiptType =
      typeof receiptType === "string" && receiptType.trim().length > 0
        ? receiptType.trim().toUpperCase()
        : ReceiptType.NORMAL;
    if (!Object.values(ReceiptType).includes(normalizedReceiptType as ReceiptType)) {
      return res.status(400).json({ error: "receiptType must be NORMAL or TVA" });
    }

    const customer = await prisma.customer.create({
      data: {
        name: normalizedName,
        contactName: contactName?.trim() ?? null,
        phone: phone?.trim() ?? null,
        email: email?.trim() ?? null,
        notes: notes?.trim() ?? null,
        receiptType: normalizedReceiptType as ReceiptType,
      },
      include: {
        manualBalanceUpdatedBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.status(201).json(customer);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to create customer" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid customer id" });
    }

    const { name, contactName, phone, email, notes, receiptType } = req.body;
    const updateData: Record<string, string | null | ReceiptType> = {};

    if (name !== undefined) {
      const normalizedName = typeof name === "string" ? name.trim() : "";
      if (!normalizedName) {
        return res.status(400).json({ error: "name is required" });
      }
      updateData.name = normalizedName;
    }

    if (contactName !== undefined) {
      updateData.contactName =
        typeof contactName === "string" && contactName.trim().length > 0
          ? contactName.trim()
          : null;
    }

    if (phone !== undefined) {
      updateData.phone =
        typeof phone === "string" && phone.trim().length > 0 ? phone.trim() : null;
    }

    if (email !== undefined) {
      updateData.email =
        typeof email === "string" && email.trim().length > 0 ? email.trim() : null;
    }

    if (notes !== undefined) {
      updateData.notes =
        typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null;
    }

    if (receiptType !== undefined) {
      const normalizedReceiptType =
        typeof receiptType === "string" && receiptType.trim().length > 0
          ? receiptType.trim().toUpperCase()
          : null;
      if (!normalizedReceiptType || !Object.values(ReceiptType).includes(normalizedReceiptType as ReceiptType)) {
        return res.status(400).json({ error: "receiptType must be NORMAL or TVA" });
      }
      updateData.receiptType = normalizedReceiptType as ReceiptType;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No fields provided to update" });
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: updateData,
      include: {
        manualBalanceUpdatedBy: { select: { id: true, name: true, email: true } },
      },
    });

    res.json(customer);
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Customer not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update customer" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid customer id" });
    }

    const receiptCount = await prisma.receipt.count({ where: { customerId: id } });
    if (receiptCount > 0) {
      return res
        .status(400)
        .json({ error: "Cannot delete a customer that has associated receipts" });
    }

    await prisma.customer.delete({ where: { id } });
    res.json({ message: "Customer deleted" });
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Customer not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to delete customer" });
  }
});

router.post("/:id/manual-balance", requireRole(UserRole.ADMIN), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid customer id" });
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

    const customer = await prisma.customer.update({
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
      action: normalizedAmount !== null ? "CUSTOMER_BALANCE_OVERRIDE" : "CUSTOMER_BALANCE_CLEAR",
      entityType: "CUSTOMER",
      entityId: id,
      description:
        normalizedAmount !== null
          ? `Set manual balance to ${normalizedAmount}`
          : "Cleared manual balance override",
      user: req.user?.email ?? null,
      metadata: {
        amount: normalizedAmount,
        note: normalizedNote,
      },
    });

    res.json(customer);
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Customer not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update manual balance" });
  }
});

export default router;
