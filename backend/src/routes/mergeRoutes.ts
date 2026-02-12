import { Router } from "express";
import { UserRole } from "@prisma/client";
import prisma from "../prismaClient";
import { requireRole } from "../middleware/auth";
import { logAudit } from "../utils/auditLogger";
import { computeInventoryAmount } from "../utils/cashFlows";

const router = Router();

type MergePayload = { sourceId?: number | string; targetId?: number | string };

function parseIds(body: MergePayload) {
  const source = Number(body.sourceId);
  const target = Number(body.targetId);
  if (!Number.isFinite(source) || !Number.isFinite(target)) {
    throw new Error("Both sourceId and targetId must be valid numbers");
  }
  if (source === target) {
    throw new Error("sourceId and targetId must be different");
  }
  return { source, target };
}

router.post("/customers", requireRole(UserRole.ADMIN), async (req, res) => {
  try {
    const { source, target } = parseIds(req.body ?? {});

    const result = await prisma.$transaction(async (tx) => {
      const customers = await tx.customer.findMany({
        where: { id: { in: [source, target] } },
        select: { id: true, name: true, manualBalanceOverride: true, manualBalanceNote: true },
      });
      if (customers.length !== 2) {
        throw new Error("One or both customer IDs do not exist");
      }

      // Move references
      await Promise.all([
        tx.receipt.updateMany({ where: { customerId: source }, data: { customerId: target } }),
        tx.payment.updateMany({ where: { customerId: source }, data: { customerId: target } }),
        tx.jobSite.updateMany({ where: { customerId: source }, data: { customerId: target } }),
        tx.invoice.updateMany({ where: { customerId: source }, data: { customerId: target } }),
        tx.debrisEntry.updateMany({ where: { customerId: source }, data: { customerId: target } }),
        (tx as any).customerSupplierLink?.deleteMany({ where: { customerId: source } }),
      ]);

      // Combine manual balance overrides (additive) onto target
      const sourceCustomer = customers.find((c) => c.id === source)!;
      const targetCustomer = customers.find((c) => c.id === target)!;
      if (sourceCustomer.manualBalanceOverride !== null || sourceCustomer.manualBalanceNote) {
        const combinedAmount =
          (targetCustomer.manualBalanceOverride ?? 0) + (sourceCustomer.manualBalanceOverride ?? 0);
        await tx.customer.update({
          where: { id: target },
          data: {
            manualBalanceOverride: combinedAmount,
            manualBalanceNote: sourceCustomer.manualBalanceNote ?? targetCustomer.manualBalanceNote,
            manualBalanceUpdatedAt: new Date(),
          },
        });
      }

      await tx.customer.delete({ where: { id: source } });

      await logAudit({
        action: "CUSTOMER_MERGE",
        entityType: "CUSTOMER",
        entityId: target,
        description: `Merged customer ${source} into ${target}`,
        user: req.user?.email ?? null,
        metadata: { source, target },
      });

      return { sourceName: sourceCustomer.name, targetName: targetCustomer.name };
    });

    res.json({ message: "Customers merged", ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Failed to merge customers" });
  }
});

router.post("/suppliers", requireRole(UserRole.ADMIN), async (req, res) => {
  try {
    const { source, target } = parseIds(req.body ?? {});

    const result = await prisma.$transaction(async (tx) => {
      const suppliers = await tx.supplier.findMany({
        where: { id: { in: [source, target] } },
        select: { id: true, name: true, manualBalanceOverride: true, manualBalanceNote: true },
      });
      if (suppliers.length !== 2) {
        throw new Error("One or both supplier IDs do not exist");
      }

      await Promise.all([
        tx.inventoryEntry.updateMany({ where: { supplierId: source }, data: { supplierId: target } }),
        tx.payment.updateMany({ where: { supplierId: source }, data: { supplierId: target } }),
        tx.truckRepair.updateMany({ where: { supplierId: source }, data: { supplierId: target } }),
        tx.debrisEntry.updateMany({ where: { supplierId: source }, data: { supplierId: target } }),
        (tx as any).customerSupplierLink?.deleteMany({ where: { supplierId: source } }),
      ]);

      const sourceSupplier = suppliers.find((s) => s.id === source)!;
      const targetSupplier = suppliers.find((s) => s.id === target)!;
      if (sourceSupplier.manualBalanceOverride !== null || sourceSupplier.manualBalanceNote) {
        const combinedAmount =
          (targetSupplier.manualBalanceOverride ?? 0) + (sourceSupplier.manualBalanceOverride ?? 0);
        await tx.supplier.update({
          where: { id: target },
          data: {
            manualBalanceOverride: combinedAmount,
            manualBalanceNote: sourceSupplier.manualBalanceNote ?? targetSupplier.manualBalanceNote,
            manualBalanceUpdatedAt: new Date(),
          },
        });
      }

      await tx.supplier.delete({ where: { id: source } });

      await logAudit({
        action: "SUPPLIER_MERGE",
        entityType: "SUPPLIER",
        entityId: target,
        description: `Merged supplier ${source} into ${target}`,
        user: req.user?.email ?? null,
        metadata: { source, target },
      });

      return { sourceName: sourceSupplier.name, targetName: targetSupplier.name };
    });

    res.json({ message: "Suppliers merged", ...result });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Failed to merge suppliers" });
  }
});

router.post("/pair-customer-supplier", requireRole(UserRole.ADMIN), async (req, res) => {
  try {
    const customerId = Number(req.body?.customerId);
    const supplierId = Number(req.body?.supplierId);
    if (!Number.isFinite(customerId) || !Number.isFinite(supplierId)) {
      return res.status(400).json({ error: "customerId and supplierId are required" });
    }

    const [customer, supplier] = await Promise.all([
      prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true } }),
      prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } }),
    ]);
    if (!customer || !supplier) {
      return res.status(404).json({ error: "Customer or supplier not found" });
    }

    await prisma.$transaction(async (tx) => {
      // Ensure 1:1 by clearing existing pairings
      await (tx as any).customerSupplierLink?.deleteMany({
        where: { OR: [{ customerId }, { supplierId }] },
      });

      await (tx as any).customerSupplierLink.create({
        data: { customerId, supplierId },
      });

      await logAudit({
        action: "CUSTOMER_SUPPLIER_PAIR",
        entityType: "CUSTOMER",
        entityId: customerId,
        description: `Paired customer ${customerId} with supplier ${supplierId}`,
        user: req.user?.email ?? null,
        metadata: { customerId, supplierId },
      });
    });

    res.json({
      message: "Customer and supplier paired",
      customer: customer.name,
      supplier: supplier.name,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Failed to pair customer and supplier" });
  }
});

// Apply barter-style settlement between paired customer/supplier:
// reduce customer receipts outstanding using supplier purchase outstanding (oldest-first).
router.post("/settle-pairs", requireRole(UserRole.ADMIN), async (req, res) => {
  try {
    const pairs =
      (prisma as any).customerSupplierLink && typeof (prisma as any).customerSupplierLink.findMany === "function"
        ? await (prisma as any).customerSupplierLink.findMany()
        : [];
    if (!pairs.length) {
      return res.json({ message: "No pairs to settle", applied: [] });
    }

    const applied: Array<{
      customerId: number;
      supplierId: number;
      appliedToReceipts: number;
      appliedToPurchases: number;
    }> = [];

    for (const pair of pairs) {
      // Fetch unpaid receipts and unpaid purchases
      const receipts = await prisma.receipt.findMany({
        where: { customerId: pair.customerId, isPaid: false },
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: { id: true, total: true, amountPaid: true, isPaid: true },
      });
      const purchases = await prisma.inventoryEntry.findMany({
        where: { supplierId: pair.supplierId, type: "PURCHASE", isPaid: false },
        orderBy: [{ entryDate: "asc" }, { id: "asc" }],
        select: { id: true, totalCost: true, unitCost: true, quantity: true, amountPaid: true, isPaid: true },
      });

      const totalReceiptOutstanding = receipts.reduce((sum, r) => {
        const paid = Math.max(Number(r.amountPaid ?? 0), r.isPaid ? Number(r.total ?? 0) : 0);
        return sum + Math.max(Number(r.total ?? 0) - paid, 0);
      }, 0);

      const totalPurchaseOutstanding = purchases.reduce((sum, p) => {
        const total = computeInventoryAmount({
          totalCost: p.totalCost ?? null,
          unitCost: p.unitCost ?? null,
          quantity: p.quantity,
        });
        const paid = Math.max(Number(p.amountPaid ?? 0), p.isPaid ? Number(total) : 0);
        return sum + Math.max(total - paid, 0);
      }, 0);

      let remaining = Math.min(totalReceiptOutstanding, totalPurchaseOutstanding);
      if (remaining <= 0) {
        applied.push({ customerId: pair.customerId, supplierId: pair.supplierId, appliedToReceipts: 0, appliedToPurchases: 0 });
        continue;
      }

      let appliedReceipts = 0;
      let appliedPurchases = 0;

      await prisma.$transaction(async (tx) => {
        for (const r of receipts) {
          if (remaining <= 0) break;
          const paid = Math.max(Number(r.amountPaid ?? 0), r.isPaid ? Number(r.total ?? 0) : 0);
          const outstanding = Math.max(Number(r.total ?? 0) - paid, 0);
          if (outstanding <= 0) continue;
          const apply = Math.min(outstanding, remaining);
          appliedReceipts += apply;
          remaining -= apply;
          const newPaid = paid + apply;
          await tx.receipt.update({
            where: { id: r.id },
            data: {
              amountPaid: newPaid,
              isPaid: newPaid >= Number(r.total ?? 0) - 1e-6,
            },
          });
        }

        remaining = Math.min(remaining, remaining); // no-op, keeps type happy

        for (const p of purchases) {
          if (appliedReceipts <= appliedPurchases) break;
          const total = computeInventoryAmount({
            totalCost: p.totalCost ?? null,
            unitCost: p.unitCost ?? null,
            quantity: p.quantity,
          });
          const paid = Math.max(Number(p.amountPaid ?? 0), p.isPaid ? Number(total) : 0);
          const outstanding = Math.max(total - paid, 0);
          if (outstanding <= 0) continue;
          const need = appliedReceipts - appliedPurchases;
          const apply = Math.min(outstanding, need);
          appliedPurchases += apply;
          await tx.inventoryEntry.update({
            where: { id: p.id },
            data: {
              amountPaid: paid + apply,
              isPaid: paid + apply >= total - 1e-6,
            },
          });
        }
      });

      applied.push({
        customerId: pair.customerId,
        supplierId: pair.supplierId,
        appliedToReceipts: appliedReceipts,
        appliedToPurchases: appliedPurchases,
      });

      await logAudit({
        action: "PAIR_SETTLE",
        entityType: "CUSTOMER",
        entityId: pair.customerId,
        description: `Settled paired balances between customer ${pair.customerId} and supplier ${pair.supplierId}`,
        user: req.user?.email ?? null,
        metadata: { appliedReceipts, appliedPurchases },
      });
    }

    res.json({ message: "Paired balances settled", applied });
  } catch (err: any) {
    res.status(400).json({ error: err.message ?? "Failed to settle pairs" });
  }
});

export default router;
