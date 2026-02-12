import { Router } from "express";
import prisma from "../prismaClient";
import { logAudit } from "../utils/auditLogger";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { limit = "100" } = req.query;
    const parsedLimit = Number(limit);
    const take = Number.isNaN(parsedLimit) || parsedLimit <= 0 ? 100 : Math.min(parsedLimit, 500);

    const logs = await prisma.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take,
    });

    res.json(logs);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch audit logs" });
  }
});

router.post("/invoice-print", async (req, res) => {
  const { customerId, receiptIds } = req.body ?? {};
  if (!customerId || Number.isNaN(Number(customerId))) {
    return res.status(400).json({ error: "customerId is required" });
  }

  await logAudit({
    action: "INVOICE_PRINTED",
    entityType: "invoice",
    entityId: Number(customerId),
    description: `Invoice printed for customer ${customerId}`,
    user: req.user?.email ?? req.user?.name ?? null,
    metadata: {
      receiptIds: Array.isArray(receiptIds)
        ? receiptIds.filter((id: any) => typeof id === "number")
        : [],
    },
  });

  res.json({ ok: true });
});

router.get("/activity", async (req, res) => {
  try {
    const receiptLogs = await prisma.auditLog.groupBy({
      by: ["entityId", "action"],
      where: {
        entityType: "receipt",
        entityId: { not: null },
        action: { in: ["RECEIPT_PRINTED", "RECEIPT_UPDATED", "RECEIPT_DELETED"] },
      },
      _count: { _all: true },
      _max: { createdAt: true },
    });

    const receiptIds = Array.from(
      new Set(
        receiptLogs
          .map((entry) => entry.entityId)
          .filter((id): id is number => typeof id === "number"),
      ),
    );

    type ReceiptActivityRecord = {
      receiptId: number;
      receiptNo: string;
      customerName: string;
      issuedOn: Date | null;
      printCount: number;
      updateCount: number;
      deleteCount: number;
      lastPrintedAt: Date | null;
      lastUpdatedAt: Date | null;
      lastDeletedAt: Date | null;
    };

    const receiptDetails = receiptIds.length
      ? await prisma.receipt.findMany({
          where: { id: { in: receiptIds } },
          select: {
            id: true,
            receiptNo: true,
            walkInName: true,
            customer: { select: { name: true } },
            date: true,
          },
        })
      : [];

    const receiptMap = new Map<number, ReceiptActivityRecord>(
      receiptDetails.map((receipt) => [
        receipt.id,
        {
          receiptId: receipt.id,
          receiptNo: receipt.receiptNo ?? `#${receipt.id}`,
          customerName: receipt.customer?.name ?? receipt.walkInName ?? "Walk-in",
          issuedOn: receipt.date ?? null,
          printCount: 0,
          updateCount: 0,
          deleteCount: 0,
          lastPrintedAt: null,
          lastUpdatedAt: null,
          lastDeletedAt: null,
        },
      ]),
    );

    receiptLogs.forEach((log) => {
      if (!log.entityId) return;
      if (!receiptMap.has(log.entityId)) {
        receiptMap.set(log.entityId, {
          receiptId: log.entityId,
          receiptNo: `#${log.entityId}`,
          customerName: "Unknown",
          issuedOn: null,
          printCount: 0,
          updateCount: 0,
          deleteCount: 0,
          lastPrintedAt: null,
          lastUpdatedAt: null,
          lastDeletedAt: null,
        });
      }
      const record = receiptMap.get(log.entityId)!;
      switch (log.action) {
        case "RECEIPT_PRINTED":
          record.printCount = log._count._all;
          record.lastPrintedAt = log._max.createdAt;
          break;
        case "RECEIPT_UPDATED":
          record.updateCount = log._count._all;
          record.lastUpdatedAt = log._max.createdAt;
          break;
        case "RECEIPT_DELETED":
          record.deleteCount = log._count._all;
          record.lastDeletedAt = log._max.createdAt;
          break;
        default:
          break;
      }
    });

    const invoiceLogs = await prisma.auditLog.groupBy({
      by: ["entityId"],
      where: {
        entityType: "invoice",
        action: "INVOICE_PRINTED",
        entityId: { not: null },
      },
      _count: { _all: true },
      _max: { createdAt: true },
    });

    const invoiceCustomerIds = invoiceLogs
      .map((entry) => entry.entityId)
      .filter((id): id is number => typeof id === "number");

    const customerDetails = invoiceCustomerIds.length
      ? await prisma.customer.findMany({
          where: { id: { in: invoiceCustomerIds } },
          select: { id: true, name: true, contactName: true },
        })
      : [];

    const customerMap = new Map(customerDetails.map((c) => [c.id, c]));

    const invoiceSummary = invoiceLogs.map((entry) => ({
      customerId: entry.entityId!,
      customerName: customerMap.get(entry.entityId!)?.name ?? `Customer ${entry.entityId}`,
      printCount: entry._count._all,
      lastPrintedAt: entry._max.createdAt,
    }));

    res.json({
      receipts: Array.from(receiptMap.values()).sort(
        (a, b) => (b.lastPrintedAt?.getTime() ?? 0) - (a.lastPrintedAt?.getTime() ?? 0),
      ),
      invoices: invoiceSummary.sort(
        (a, b) => (b.lastPrintedAt?.getTime() ?? 0) - (a.lastPrintedAt?.getTime() ?? 0),
      ),
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to compute activity summary" });
  }
});

export default router;
