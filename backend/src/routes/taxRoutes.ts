import { Router } from "express";
import { InventoryEntryType, ReceiptType, Prisma } from "@prisma/client";
import prisma from "../prismaClient";
import { logAudit } from "../utils/auditLogger";

const router = Router();

const parseDate = (value: unknown): Date | null => {
  if (!value || typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const endOfDay = (value: Date | null): Date | null => {
  if (!value) return null;
  const copy = new Date(value);
  copy.setHours(23, 59, 59, 999);
  return copy;
};

router.get("/reports", async (req, res) => {
  try {
    const startDate = parseDate(req.query.startDate);
    const endDate = endOfDay(parseDate(req.query.endDate));
    const customerId =
      typeof req.query.customerId === "string" && req.query.customerId.trim().length > 0
        ? Number(req.query.customerId)
        : null;
    const supplierId =
      typeof req.query.supplierId === "string" && req.query.supplierId.trim().length > 0
        ? Number(req.query.supplierId)
        : null;

    const receiptWhere: Prisma.ReceiptWhereInput = {
      type: ReceiptType.TVA,
    };
    if (startDate || endDate) {
      receiptWhere.date = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
    }
    if (customerId) {
      receiptWhere.customerId = customerId;
    }

    const payrollWhere =
      startDate || endDate
        ? {
            periodEnd: {
              ...(startDate ? { gte: startDate } : {}),
              ...(endDate ? { lte: endDate } : {}),
            },
          }
        : {};

    const cashWhere: Prisma.CashEntryWhereInput = {};
    if (startDate || endDate) {
      cashWhere.createdAt = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
    }

    const [sales, purchaseRows, payrollEntries, cashEntries, customers, suppliers] =
      await Promise.all([
      prisma.receipt.findMany({
        where: receiptWhere,
        orderBy: [{ date: "asc" }, { id: "asc" }],
        select: {
          id: true,
          receiptNo: true,
          date: true,
          type: true,
          total: true,
          amountPaid: true,
          isPaid: true,
          customer: { select: { name: true } },
          walkInName: true,
        },
      }),
      prisma.$queryRaw<
        Array<{
          id: number;
          entryDate: Date;
          supplierName: string | null;
          productName: string | null;
          quantity: number;
          unitCost: number | null;
          totalCost: number | null;
          isPaid: boolean;
          notes: string | null;
        }>
      >(Prisma.sql`
        SELECT ie."id",
               ie."entryDate",
               ie."quantity",
               ie."unitCost",
               ie."totalCost",
               ie."isPaid",
               ie."notes",
               s."name" AS "supplierName",
               p."name" AS "productName"
        FROM "InventoryEntry" ie
        LEFT JOIN "Supplier" s ON s."id" = ie."supplierId"
        LEFT JOIN "Product" p ON p."id" = ie."productId"
        WHERE ie."type" = ${Prisma.raw(`'${InventoryEntryType.PURCHASE}'::"InventoryEntryType"`)}
          AND ie."tvaEligible" = true
          ${startDate ? Prisma.sql`AND ie."entryDate" >= ${startDate}` : Prisma.empty}
          ${endDate ? Prisma.sql`AND ie."entryDate" <= ${endDate}` : Prisma.empty}
          ${supplierId ? Prisma.sql`AND ie."supplierId" = ${supplierId}` : Prisma.empty}
        ORDER BY ie."entryDate" ASC, ie."id" ASC
      `),
      prisma.payrollEntry.findMany({
        where: payrollWhere,
        orderBy: [{ periodEnd: "asc" }, { id: "asc" }],
        select: {
          id: true,
          periodStart: true,
          periodEnd: true,
          type: true,
          amount: true,
          quantity: true,
          notes: true,
          employee: { select: { name: true } },
        },
      }),
      prisma.cashEntry.findMany({
        where: cashWhere,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          createdAt: true,
          type: true,
          amount: true,
          description: true,
          createdByUser: { select: { name: true, email: true } },
        },
      }),
      prisma.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      prisma.supplier.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    ]);

    const statementMap = new Map<
      string,
      { name: string; total: number; paid: number; outstanding: number }
    >();

    const salesRecords = sales.map((receipt) => {
      const customerName = receipt.customer?.name ?? receipt.walkInName ?? "Walk-in";
      const paid = Number(receipt.amountPaid ?? 0);
      const outstanding = Math.max(Number(receipt.total) - paid, 0);
      const key = customerName.toLowerCase();
      if (!statementMap.has(key)) {
        statementMap.set(key, { name: customerName, total: 0, paid: 0, outstanding: 0 });
      }
      const bucket = statementMap.get(key)!;
      bucket.total += Number(receipt.total);
      bucket.paid += paid;
      bucket.outstanding += outstanding;

      return {
        id: receipt.id,
        receiptNo: receipt.receiptNo,
        date: receipt.date.toISOString(),
        customerName,
        type: receipt.type,
        total: Number(receipt.total),
        amountPaid: paid,
        outstanding,
        isPaid: receipt.isPaid,
      };
    });

    const statementOfAccount = Array.from(statementMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );

    const purchaseRecords = purchaseRows.map((entry) => ({
      id: entry.id,
      date: entry.entryDate.toISOString(),
      supplierName: entry.supplierName ?? null,
      productName: entry.productName ?? "Unknown",
      quantity: Number(entry.quantity),
      unitCost: entry.unitCost ?? null,
      totalCost: entry.totalCost ?? null,
      isPaid: entry.isPaid,
      notes: entry.notes ?? null,
    }));

    const payrollRecords = payrollEntries.map((entry) => ({
      id: entry.id,
      periodStart: entry.periodStart.toISOString(),
      periodEnd: entry.periodEnd.toISOString(),
      employeeName: entry.employee.name,
      type: entry.type,
      amount: Number(entry.amount),
      quantity: entry.quantity ?? null,
      notes: entry.notes ?? null,
    }));

    const cashRecords = cashEntries.map((entry) => ({
      id: entry.id,
      date: entry.createdAt.toISOString(),
      type: entry.type,
      amount: Number(entry.amount),
      description: entry.description ?? null,
      createdBy: entry.createdByUser?.name ?? entry.createdByUser?.email ?? null,
    }));

    const salesTotal = salesRecords.reduce((sum, row) => sum + row.total, 0);
    const purchaseTotal = purchaseRecords.reduce((sum, row) => sum + (row.totalCost ?? 0), 0);
    const payrollTotal = payrollRecords.reduce((sum, row) => sum + row.amount, 0);
    const cashIn = cashRecords
      .filter((row) => row.amount >= 0)
      .reduce((sum, row) => sum + row.amount, 0);
    const cashOut = cashRecords
      .filter((row) => row.amount < 0)
      .reduce((sum, row) => sum + Math.abs(row.amount), 0);
    const netPosition = salesTotal - purchaseTotal - payrollTotal;

    const trialBalance = [
      { account: "Sales", debit: 0, credit: salesTotal },
      { account: "Purchases", debit: purchaseTotal, credit: 0 },
      { account: "Payroll", debit: payrollTotal, credit: 0 },
      { account: "Cash inflows", debit: cashIn, credit: 0 },
      { account: "Cash outflows", debit: 0, credit: cashOut },
      {
        account: "Net position",
        debit: netPosition >= 0 ? netPosition : 0,
        credit: netPosition < 0 ? Math.abs(netPosition) : 0,
      },
    ];

    const payload = {
      filters: {
        startDate: startDate ? startDate.toISOString() : null,
        endDate: endDate ? endDate.toISOString() : null,
        customerId: customerId ?? null,
        supplierId: supplierId ?? null,
      },
      sales: salesRecords,
      purchases: purchaseRecords,
      payroll: payrollRecords,
      cash: cashRecords,
      statementOfAccount,
      trialBalance,
      customers,
      suppliers,
    };

    await logAudit({
      action: "TAX_REPORT_VIEWED",
      entityType: "tax",
      entityId: null,
      description: "Tax reports viewed",
      metadata: payload.filters,
    });

    res.json(payload);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to generate tax reports" });
  }
});

export default router;
