import { Router } from "express";
import { PaymentType, Prisma, UserRole } from "@prisma/client";
import prisma from "../prismaClient";
import { requireRole } from "../middleware/auth";
import { fetchCashFlows } from "../utils/cashFlows";

const router = Router();

// Admin-only health checks for receivables/payments integrity
router.get("/receivables-health", requireRole(UserRole.ADMIN), async (_req, res) => {
  try {
    // Receipts and payment links
    const [receipts, receiptPaymentSums, directReceiptPayments, payments] = await Promise.all([
      prisma.receipt.findMany({
        select: {
          id: true,
          customerId: true,
          total: true,
          amountPaid: true,
          isPaid: true,
        },
      }),
      prisma.receiptPayment.groupBy({
        by: ["receiptId"],
        _sum: { amount: true },
      }),
      prisma.payment.groupBy({
        by: ["receiptId"],
        _sum: { amount: true },
        where: { receiptId: { not: null }, type: PaymentType.RECEIPT },
      }),
      prisma.payment.findMany({
        select: {
          id: true,
          type: true,
          customerId: true,
          receiptId: true,
          amount: true,
        },
      }),
    ]);

    const paidMap = new Map<number, number>();
    receiptPaymentSums.forEach((r) => paidMap.set(r.receiptId, Number(r._sum.amount ?? 0)));
    directReceiptPayments.forEach((p) => {
      if (p.receiptId === null) return;
      paidMap.set(p.receiptId, (paidMap.get(p.receiptId) ?? 0) + Number(p._sum.amount ?? 0));
    });

    const mismatchedReceipts = receipts
      .map((r) => {
        const linkedPaid = paidMap.get(r.id) ?? 0;
        const storedPaid = Number(r.amountPaid ?? 0);
        const effectivePaid = Math.max(linkedPaid, storedPaid);
        const total = Number(r.total ?? 0);
        const shouldBePaid = effectivePaid >= total - 1e-6;
        const delta = Math.abs(storedPaid - effectivePaid);
        return {
          id: r.id,
          customerId: r.customerId,
          total,
          storedPaid,
          linkedPaid,
          storedIsPaid: r.isPaid,
          shouldBePaid,
          delta,
        };
      })
      .filter((r) => r.delta > 0.01 || r.storedIsPaid !== r.shouldBePaid);

    // Orphans: links whose receipt or payment no longer exists
    const receiptPayments = await prisma.receiptPayment.findMany({
      select: { id: true, receiptId: true, paymentId: true },
    });
    let orphanReceiptPayments: { id: number; receiptId: number | null; paymentId: number | null }[] =
      [];
    if (receiptPayments.length > 0) {
      const receiptIds = receiptPayments
        .map((r) => r.receiptId)
        .filter((id): id is number => id !== null);
      const paymentIds = receiptPayments
        .map((r) => r.paymentId)
        .filter((id): id is number => id !== null);
      const [existingReceipts, existingPayments] = await Promise.all([
        receiptIds.length
          ? prisma.receipt.findMany({ where: { id: { in: receiptIds } }, select: { id: true } })
          : [],
        paymentIds.length
          ? prisma.payment.findMany({ where: { id: { in: paymentIds } }, select: { id: true } })
          : [],
      ]);
      const receiptSet = new Set(existingReceipts.map((r) => r.id));
      const paymentSet = new Set(existingPayments.map((p) => p.id));
      orphanReceiptPayments = receiptPayments.filter(
        (r) =>
          (r.receiptId !== null && !receiptSet.has(r.receiptId)) ||
          (r.paymentId !== null && !paymentSet.has(r.paymentId)),
      );
    }

    const invalidPayments = payments.filter((p) => {
      if (p.type === PaymentType.RECEIPT && p.receiptId === null) return true;
      if (p.type === PaymentType.CUSTOMER_PAYMENT && p.customerId === null) return true;
      return false;
    });

    // Per-customer outstanding from receipts only
    const outstandingByCustomer = new Map<number, number>();
    receipts.forEach((r) => {
      if (!r.customerId) return;
      const paid = paidMap.get(r.id) ?? 0;
      const outstanding = Math.max(Number(r.total ?? 0) - paid, 0);
      outstandingByCustomer.set(
        r.customerId,
        (outstandingByCustomer.get(r.customerId) ?? 0) + outstanding,
      );
    });
    const topOutstanding = Array.from(outstandingByCustomer.entries())
      .map(([customerId, outstanding]) => ({ customerId, outstanding }))
      .sort((a, b) => b.outstanding - a.outstanding)
      .slice(0, 20);

    res.json({
      mismatchedReceipts,
      orphanReceiptPayments,
      invalidPayments,
      topOutstanding,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to run receivables health check" });
  }
});

// Recompute receipt.amountPaid/isPaid from payments/links for selected scope (or all).
router.post("/recompute-receipt-balances", requireRole(UserRole.ADMIN), async (req, res) => {
  try {
    const { receiptId, customerId } = req.body ?? {};
    const where: Prisma.ReceiptWhereInput = {};
    if (receiptId !== undefined && receiptId !== null && `${receiptId}`.trim() !== "") {
      const parsed = Number(receiptId);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ error: "Invalid receiptId" });
      }
      where.id = parsed;
    }
    if (customerId !== undefined && customerId !== null && `${customerId}`.trim() !== "") {
      const parsed = Number(customerId);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ error: "Invalid customerId" });
      }
      where.customerId = parsed;
    }

    const receipts = await prisma.receipt.findMany({
      where,
      select: { id: true, total: true, amountPaid: true, isPaid: true },
    });
    if (receipts.length === 0) {
      return res.json({ updated: 0, skipped: 0 });
    }

    const ids = receipts.map((r) => r.id);
    const linkSums = await prisma.receiptPayment.groupBy({
      by: ["receiptId"],
      _sum: { amount: true },
      where: { receiptId: { in: ids } },
    });
    const linkMap = new Map<number, number>();
    linkSums.forEach((row) => linkMap.set(row.receiptId, Number(row._sum.amount ?? 0)));

    const directSums = await prisma.payment.groupBy({
      by: ["receiptId"],
      _sum: { amount: true },
      where: { receiptId: { in: ids }, type: { in: [PaymentType.RECEIPT, PaymentType.CUSTOMER_PAYMENT] } },
    });
    const directMap = new Map<number, number>();
    directSums.forEach((row) => {
      if (row.receiptId === null) return;
      directMap.set(row.receiptId, Number(row._sum.amount ?? 0));
    });

    let updated = 0;
    for (const receipt of receipts) {
      const linkedPaid = linkMap.get(receipt.id) ?? 0;
      const directPaid = directMap.get(receipt.id) ?? 0;
      const amountPaidField = Number(receipt.amountPaid ?? 0);
      const paidFromFlag = receipt.isPaid ? Number(receipt.total ?? 0) : 0;
      const paid = Math.max(linkedPaid, directPaid, amountPaidField, paidFromFlag);
      const shouldBePaid = paid >= Number(receipt.total ?? 0) - 1e-6;
      if (Math.abs(paid - amountPaidField) > 1e-6 || Boolean(shouldBePaid) !== Boolean(receipt.isPaid)) {
        await prisma.receipt.update({
          where: { id: receipt.id },
          data: { amountPaid: paid, isPaid: shouldBePaid },
        });
        updated += 1;
      }
    }

    res.json({ updated, skipped: receipts.length - updated });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to recompute receipt balances" });
  }
});

// Admin-only repair: recompute amountPaid/isPaid for mismatched receipts
router.post("/receivables-repair", requireRole(UserRole.ADMIN), async (_req, res) => {
  try {
    const [receipts, receiptPaymentSums, directReceiptPayments] = await Promise.all([
      prisma.receipt.findMany({
        select: { id: true, total: true, amountPaid: true, isPaid: true },
      }),
      prisma.receiptPayment.groupBy({
        by: ["receiptId"],
        _sum: { amount: true },
      }),
      prisma.payment.groupBy({
        by: ["receiptId"],
        _sum: { amount: true },
        where: { receiptId: { not: null }, type: PaymentType.RECEIPT },
      }),
    ]);

    const paidMap = new Map<number, number>();
    receiptPaymentSums.forEach((r) => paidMap.set(r.receiptId, Number(r._sum.amount ?? 0)));
    directReceiptPayments.forEach((p) => {
      if (p.receiptId === null) return;
      paidMap.set(p.receiptId, (paidMap.get(p.receiptId) ?? 0) + Number(p._sum.amount ?? 0));
    });

    const mismatched = receipts
      .map((r) => {
        const linkedPaid = paidMap.get(r.id) ?? 0;
        return {
          id: r.id,
          total: Number(r.total ?? 0),
          storedPaid: Number(r.amountPaid ?? 0),
          linkedPaid,
          storedIsPaid: r.isPaid,
          shouldBePaid: linkedPaid >= Number(r.total ?? 0) - 1e-6,
          delta: Math.abs(Number(r.amountPaid ?? 0) - linkedPaid),
        };
      })
      .filter((r) => r.delta > 0.01 || r.storedIsPaid !== r.shouldBePaid);

    for (const r of mismatched) {
      await prisma.receipt.update({
        where: { id: r.id },
        data: {
          amountPaid: r.linkedPaid,
          isPaid: r.linkedPaid >= r.total - 1e-6,
        },
      });
    }

    res.json({
      repaired: mismatched.map((r) => ({ id: r.id, newPaid: r.linkedPaid })),
      count: mismatched.length,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to repair receipts" });
  }
});

// Admin-only repair for a single receipt
router.post("/receipts/:id/repair", requireRole(UserRole.ADMIN), async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: "Invalid receipt id" });
  }
  try {
    const [receipt, linkSum, directSum] = await Promise.all([
      prisma.receipt.findUnique({ where: { id }, select: { id: true, total: true } }),
      prisma.receiptPayment.aggregate({
        _sum: { amount: true },
        where: { receiptId: id },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { receiptId: id, type: PaymentType.RECEIPT },
      }),
    ]);
    if (!receipt) {
      return res.status(404).json({ error: "Receipt not found" });
    }
    const linkedPaid = Number(linkSum._sum.amount ?? 0) + Number(directSum._sum.amount ?? 0);
    const updated = await prisma.receipt.update({
      where: { id },
      data: {
        amountPaid: linkedPaid,
        isPaid: linkedPaid >= Number(receipt.total ?? 0) - 1e-6,
      },
    });
    res.json({ id: updated.id, amountPaid: updated.amountPaid, isPaid: updated.isPaid });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to repair receipt" });
  }
});

// Cash ledger breakdown (inflows/outflows) to debug cash on hand
router.get("/cash-ledger", requireRole(UserRole.ADMIN), async (req, res) => {
  try {
    const { start, end, allTime } = req.query;
    let range: { start?: Date; end?: Date } | undefined;
    if (!allTime) {
      const startDate = start ? new Date(String(start)) : undefined;
      const endDate = end ? new Date(String(end)) : undefined;
      if (startDate && Number.isNaN(startDate.getTime())) {
        return res.status(400).json({ error: "Invalid start date" });
      }
      if (endDate && Number.isNaN(endDate.getTime())) {
        return res.status(400).json({ error: "Invalid end date" });
      }
      if (startDate || endDate) {
        range = { start: startDate, end: endDate };
      }
    }

    const ledger = await fetchCashFlows(prisma, range);
    // Also provide quick totals by payment type
    const inflowByType: Record<string, number> = {};
    ledger.inflows.forEach((i) => {
      inflowByType[i.type] = (inflowByType[i.type] ?? 0) + i.amount;
    });
    const outflowByType: Record<string, number> = {};
    ledger.outflows.forEach((o) => {
      outflowByType[o.type] = (outflowByType[o.type] ?? 0) + o.amount;
    });

    res.json({
      ...ledger,
      inflowByType,
      outflowByType,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to load cash ledger" });
  }
});

export default router;
