import { Router } from "express";
import {
  AdminOverrideCategory,
  DebrisStatus,
  InventoryEntryType,
  PaymentType,
} from "@prisma/client";
import prisma from "../prismaClient";
import { fetchCashFlows, cashOutTypes } from "../utils/cashFlows";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      receiptsTodayAgg,
      receiptsPaidTodayAgg,
      receiptsMonthAgg,
      outstandingReceiptsAgg,
      expensesMonthAgg,
      inventoryMonthAgg,
      debrisProduct,
      debrisRemovalAgg,
      cashSummary,
      payablesAgg,
      laborPayablesSum,
      laborPayablesCount,
      manualOverrides,
      manualCustomerOverrides,
      manualSupplierOverrides,
    ] = await Promise.all([
      prisma.receipt.aggregate({
        _sum: { total: true },
        where: { date: { gte: todayStart, lt: tomorrowStart } },
      }),
      prisma.receipt.aggregate({
        _sum: { amountPaid: true },
        where: {
          amountPaid: { gt: 0 },
          date: { gte: todayStart, lt: tomorrowStart },
          isPaid: true,
          updatedAt: { gte: todayStart, lt: tomorrowStart },
        },
      }),
      prisma.receipt.aggregate({
        _sum: { total: true },
        where: { date: { gte: monthStart } },
      }),
      prisma.receipt.aggregate({
        _count: { _all: true },
        _sum: { total: true },
        where: { isPaid: false },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          date: { gte: monthStart },
          type: { in: cashOutTypes },
        },
      }),
      prisma.inventoryEntry.aggregate({
        _sum: { totalCost: true },
        where: {
          type: InventoryEntryType.PURCHASE,
          entryDate: { gte: monthStart },
        },
      }),
      prisma.product.findFirst({
        where: { name: { equals: "Debris", mode: "insensitive" } },
        select: { stockQty: true },
      }),
      prisma.debrisEntry.aggregate({
        _sum: { volume: true, removalCost: true },
        _count: { _all: true },
        where: {
          status: DebrisStatus.REMOVED,
          OR: [
            { removalDate: { gte: monthStart } },
            {
              AND: [
                { removalDate: null },
                { date: { gte: monthStart } },
              ],
            },
          ],
        },
      }),
      fetchCashFlows(prisma),
      prisma.inventoryEntry.aggregate({
        _sum: { totalCost: true },
        where: {
          type: InventoryEntryType.PURCHASE,
          isPaid: false,
        },
      }),
      prisma.inventoryEntry.aggregate({
        _sum: {
          laborAmount: true,
          helperLaborAmount: true,
        },
        where: {
          type: InventoryEntryType.PRODUCTION,
          laborPaid: false,
        },
      }),
      prisma.inventoryEntry.aggregate({
        _count: { _all: true },
        where: {
          type: InventoryEntryType.PRODUCTION,
          laborPaid: false,
        },
      }),
      prisma.adminOverride.findMany({
        where: {
          category: {
            in: [
              AdminOverrideCategory.RECEIVABLES_TOTAL,
              AdminOverrideCategory.PAYABLES_TOTAL,
            ],
          },
        },
      }),
      prisma.customer.findMany({
        where: { manualBalanceOverride: { not: null } },
        select: {
          id: true,
          manualBalanceOverride: true,
        },
      }),
      prisma.supplier.findMany({
        where: { manualBalanceOverride: { not: null } },
        select: {
          id: true,
          manualBalanceOverride: true,
        },
      }),
    ]);

    let manualCustomerSuppressedSum = 0;
    let manualCustomerSuppressedCount = 0;
    if (manualCustomerOverrides.length > 0) {
      const agg = await prisma.receipt.aggregate({
        _sum: { total: true },
        _count: { _all: true },
        where: {
          isPaid: false,
          customerId: { in: manualCustomerOverrides.map((customer) => customer.id) },
        },
      });
      manualCustomerSuppressedSum = agg._sum.total ?? 0;
      manualCustomerSuppressedCount = agg._count._all ?? 0;
    }

    let manualSupplierSuppressedTotal = 0;
    if (manualSupplierOverrides.length > 0) {
      const agg = await prisma.inventoryEntry.aggregate({
        _sum: { totalCost: true },
        where: {
          type: InventoryEntryType.PURCHASE,
          isPaid: false,
          supplierId: { in: manualSupplierOverrides.map((supplier) => supplier.id) },
        },
      });
      manualSupplierSuppressedTotal = agg._sum.totalCost ?? 0;
    }

    const manualCustomerTotal = manualCustomerOverrides.reduce(
      (sum, customer) => sum + Number(customer.manualBalanceOverride ?? 0),
      0,
    );
    const manualSupplierTotal = manualSupplierOverrides.reduce(
      (sum, supplier) => sum + Number(supplier.manualBalanceOverride ?? 0),
      0,
    );

    const { inflowTotal: cashPaidIn, outflowTotal: cashPaidOut, cashOnHand } = cashSummary;

    const upcomingPayroll = await prisma.payrollEntry.findMany({
      where: {
        paymentId: null,
      },
      include: {
        employee: true,
        stoneProduct: true,
        helperEmployee: true,
      },
      orderBy: { createdAt: "asc" },
      take: 5,
    });

    const purchasePayablesBase = payablesAgg._sum.totalCost ?? 0;
    const purchasePayables = purchasePayablesBase - manualSupplierSuppressedTotal + manualSupplierTotal;
    const laborDue =
      (laborPayablesSum._sum.laborAmount ?? 0) + (laborPayablesSum._sum.helperLaborAmount ?? 0);
    const totalPayables = purchasePayables + laborDue;
    const outstandingLaborCount = laborPayablesCount._count._all ?? 0;

    const dashboardOverrideMap = new Map<AdminOverrideCategory, number>();
    manualOverrides.forEach((override) => {
      dashboardOverrideMap.set(override.category, override.value);
    });
    const receivablesOverride = dashboardOverrideMap.get(AdminOverrideCategory.RECEIVABLES_TOTAL) ?? null;
    const payablesOverride = dashboardOverrideMap.get(AdminOverrideCategory.PAYABLES_TOTAL) ?? null;

    const baseOutstandingCount = outstandingReceiptsAgg._count._all ?? 0;
    const baseOutstandingAmount = outstandingReceiptsAgg._sum.total ?? 0;
    const adjustedOutstandingCount =
      baseOutstandingCount - manualCustomerSuppressedCount + manualCustomerOverrides.length;
    const adjustedOutstandingAmount =
      baseOutstandingAmount - manualCustomerSuppressedSum + manualCustomerTotal;

    res.json({
      receipts: {
        todayTotal: receiptsTodayAgg._sum.total ?? 0,
        todayPaid: receiptsPaidTodayAgg._sum.amountPaid ?? 0,
        monthTotal: receiptsMonthAgg._sum.total ?? 0,
        outstandingCount: adjustedOutstandingCount,
        outstandingAmount: adjustedOutstandingAmount,
      },
      finance: {
        receivables: receivablesOverride ?? adjustedOutstandingAmount,
        payables: payablesOverride ?? totalPayables,
        purchasePayables,
        laborPayables: laborDue,
        outstandingLaborCount,
      },
      expenses: {
        monthTotal:
          (expensesMonthAgg._sum.amount ?? 0) + (inventoryMonthAgg._sum.totalCost ?? 0),
      },
      cash: {
        onHand: cashOnHand,
        paidIn: cashPaidIn,
        paidOut: cashPaidOut,
      },
      debris: {
        onHandVolume: Number(debrisProduct?.stockQty ?? 0),
        removalsThisMonth: {
          count: debrisRemovalAgg._count._all ?? 0,
          volume: debrisRemovalAgg._sum.volume ?? 0,
          cost: debrisRemovalAgg._sum.removalCost ?? 0,
        },
      },
      payroll: {
        pendingEntries: upcomingPayroll,
      },
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to load dashboard" });
  }
});

export default router;
