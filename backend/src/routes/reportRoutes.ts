import { Router } from "express";
import {
  DebrisStatus,
  InventoryEntryType,
  PaymentType,
  PayrollType,
  Prisma,
  ReceiptType,
} from "@prisma/client";
import PDFDocument from "pdfkit";
import type PDFKit from "pdfkit";
import prisma from "../prismaClient";
import { fetchCustomerOutstandingSimple } from "../utils/customerBalances";
import { fetchCashFlows, computeInventoryAmount } from "../utils/cashFlows";

const router = Router();

async function getUnappliedCustomerCredits(): Promise<Map<number, number>> {
  const payments = await prisma.payment.findMany({
    where: { customerId: { not: null }, type: PaymentType.CUSTOMER_PAYMENT },
    select: {
      customerId: true,
      amount: true,
      receiptPayments: { select: { amount: true } },
    },
  });

  const creditMap = new Map<number, number>();
  payments.forEach((p) => {
    if (!p.customerId) return;
    const applied = (p.receiptPayments ?? []).reduce((sum, link) => sum + Number(link.amount ?? 0), 0);
    const remaining = Number(p.amount ?? 0) - applied;
    if (remaining > 0) {
      creditMap.set(p.customerId, (creditMap.get(p.customerId) ?? 0) + remaining);
    }
  });

  return creditMap;
}

const debrisProductName = "debris";

const toStartOfDay = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const toEndOfDay = (date: Date) => {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
};

const formatPeriodKey = (date: Date, groupBy: string) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  switch (groupBy) {
    case "month":
      return `${year}-${month}`;
    case "week": {
      const temp = new Date(date);
      const dayOfWeek = temp.getDay();
      const diff = temp.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      temp.setDate(diff);
      const startMonth = `${temp.getMonth() + 1}`.padStart(2, "0");
      const startDay = `${temp.getDate()}`.padStart(2, "0");
      return `${temp.getFullYear()}-W${startMonth}${startDay}`;
    }
    default:
      return `${year}-${month}-${day}`;
  }
};

type ProductAggregate = { productId: number; productName: string; quantity: number; revenue: number };

const incrementTimeline = (
  map: Map<string, Map<number, ProductAggregate>>,
  key: string,
  productId: number,
  productName: string,
  quantity: number,
  revenue: number,
) => {
  if (!map.has(key)) {
    map.set(key, new Map());
  }
  const inner = map.get(key)!;
  if (!inner.has(productId)) {
    inner.set(productId, { productId, productName, quantity: 0, revenue: 0 });
  }
  const slot = inner.get(productId)!;
  slot.quantity += quantity;
  slot.revenue += revenue;
};

const missingSchemaErrorCodes = new Set(["P2021", "P2022", "P1010"]);

async function safeQuery<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (err: any) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code &&
      missingSchemaErrorCodes.has(err.code)
    ) {
      console.warn("[reports] Optional query failed due to schema mismatch:", err.code);
      return fallback;
    }
    throw err;
  }
}

router.get("/summary", async (req, res) => {
  try {
    const { start, end, groupBy = "week", productIds: productIdsRaw, customerIds: customerIdsRaw } = req.query;

    const endDate = end ? new Date(String(end)) : new Date();
    const startDate = start
      ? new Date(String(start))
      : new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid start or end date" });
    }

    const rangeStart = toStartOfDay(startDate);
    const rangeEnd = toEndOfDay(endDate);

    const parsedProductIds =
      typeof productIdsRaw === "string" && productIdsRaw.trim().length > 0
        ? productIdsRaw
            .split(",")
            .map((value) => Number(value.trim()))
            .filter((value) => !Number.isNaN(value))
        : [];
    const hasProductFilter = parsedProductIds.length > 0;
    const productIdSet = new Set(parsedProductIds);

    const receiptWhere: Prisma.ReceiptWhereInput = {
      date: {
        gte: rangeStart,
        lte: rangeEnd,
      },
    };
    if (hasProductFilter) {
      receiptWhere.items = {
        some: {
          productId: {
            in: parsedProductIds,
          },
        },
      };
    }

    const parsedCustomerIds =
      typeof customerIdsRaw === "string" && customerIdsRaw.trim().length > 0
        ? customerIdsRaw
            .split(",")
            .map((value) => Number(value.trim()))
            .filter((value) => !Number.isNaN(value))
        : [];
    const hasCustomerFilter = parsedCustomerIds.length > 0;

    if (hasCustomerFilter) {
      receiptWhere.customerId = { in: parsedCustomerIds };
    }

    const outstandingWhere: Prisma.ReceiptWhereInput = {
      isPaid: false,
    };
    if (hasProductFilter) {
      outstandingWhere.items = {
        some: {
          productId: {
            in: parsedProductIds,
          },
        },
      };
    }
    if (hasCustomerFilter) {
      outstandingWhere.customerId = { in: parsedCustomerIds };
    }

    const purchaseWhere: Prisma.InventoryEntryWhereInput = {
      type: InventoryEntryType.PURCHASE,
      entryDate: {
        gte: rangeStart,
        lte: rangeEnd,
      },
    };
    if (hasProductFilter) {
      purchaseWhere.productId = { in: parsedProductIds };
    }

    const payablesWhere: Prisma.InventoryEntryWhereInput = {
      type: InventoryEntryType.PURCHASE,
      isPaid: false,
    };
    if (hasProductFilter) {
      payablesWhere.productId = { in: parsedProductIds };
    }

    const stoneProductionWhere: Prisma.InventoryEntryWhereInput = {
      type: InventoryEntryType.PRODUCTION,
      entryDate: {
        gte: rangeStart,
        lte: rangeEnd,
      },
    };
    if (hasProductFilter) {
      stoneProductionWhere.productId = { in: parsedProductIds };
    } else {
      stoneProductionWhere.product = {
        name: {
          contains: "stone",
          mode: "insensitive",
        },
      };
    }

    const productionCostWhere: Prisma.InventoryEntryWhereInput = {
      type: InventoryEntryType.PRODUCTION,
      entryDate: {
        gte: rangeStart,
        lte: rangeEnd,
      },
    };
    if (hasProductFilter) {
      productionCostWhere.productId = { in: parsedProductIds };
    }

    const [receipts, rawPayments, outstandingReceipts, purchaseEntries, payables, productsSnapshotRaw, debrisData, debrisReceipts, stoneProductionEntries, productionCostEntries] =
      await Promise.all([
        prisma.receipt.findMany({
          where: receiptWhere,
          include: {
            items: { include: { product: true } },
            receiptPayments: true,
            customer: true,
            driver: true,
            truck: true,
            jobSite: true,
          },
        }),
        prisma.payment.findMany({
          where: {
            date: {
              gte: rangeStart,
              lte: rangeEnd,
            },
            type: { in: [PaymentType.RECEIPT, PaymentType.CUSTOMER_PAYMENT] },
            ...(hasCustomerFilter
              ? {
                  OR: [
                    { customerId: { in: parsedCustomerIds } },
                    { receipt: { customerId: { in: parsedCustomerIds } } },
                  ],
                }
              : {}),
          },
          include: {
            receipt: true,
            customer: true,
          },
        }),
        prisma.receipt.findMany({
          where: outstandingWhere,
          select: {
            id: true,
            total: true,
            amountPaid: true,
            date: true,
            customerId: true,
            walkInName: true,
            customer: {
              select: { id: true, name: true },
            },
          },
        }),
        prisma.inventoryEntry.findMany({
          where: purchaseWhere,
          include: { supplier: true, product: true },
        }),
        prisma.inventoryEntry.findMany({
          where: payablesWhere,
          include: { supplier: true, product: true },
        }),
        prisma.product.findMany({
          ...(hasProductFilter ? { where: { id: { in: parsedProductIds } } } : {}),
          select: {
            id: true,
            name: true,
            stockQty: true,
            unit: true,
            unitPrice: true,
          },
        }),
        prisma.debrisEntry.findMany({
          where: {
            status: "REMOVED",
            OR: [
              { removalDate: { gte: rangeStart, lte: rangeEnd } },
              {
                AND: [
                  { removalDate: null },
                  { date: { gte: rangeStart, lte: rangeEnd } },
                ],
              },
            ],
          },
          include: { removalPayment: true },
        }),
        prisma.receiptItem.findMany({
          where: {
            receipt: {
              date: {
                gte: rangeStart,
                lte: rangeEnd,
              },
            },
            product: {
              name: {
                equals: "debris",
                mode: "insensitive",
              },
            },
          },
          include: {
            receipt: true,
          },
        }),
        prisma.inventoryEntry.findMany({
          where: stoneProductionWhere,
          include: { product: true },
        }),
        prisma.inventoryEntry.findMany({
          where: productionCostWhere,
          include: {
            product: true,
            powderProduct: true,
            cementProduct: true,
          },
        }),
      ]);

    const productsSnapshot = productsSnapshotRaw;

    const receiptIdsForFilter = new Set(receipts.map((receipt) => receipt.id));

    const payments = hasProductFilter
      ? rawPayments.filter((payment) =>
          payment.receiptId ? receiptIdsForFilter.has(payment.receiptId) : false,
        )
      : rawPayments;

    const totalSales = receipts.reduce((sum, receipt) => sum + Number(receipt.total), 0);
    const totalCashCollected = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    const customerPaymentCredits = new Map<
      number,
      { amount: number; name: string }
    >();
    payments.forEach((payment) => {
      if (
        payment.type === PaymentType.CUSTOMER_PAYMENT &&
        payment.customerId &&
        Number(payment.amount) > 0
      ) {
        const key = payment.customerId;
        if (!customerPaymentCredits.has(key)) {
          customerPaymentCredits.set(key, {
            amount: 0,
            name: payment.customer?.name ?? "Unknown",
          });
        }
        const bucket = customerPaymentCredits.get(key)!;
        bucket.amount += Number(payment.amount);
        if (!bucket.name && payment.customer?.name) {
          bucket.name = payment.customer.name;
        }
      }
    });
    const outstandingAmount = outstandingReceipts.reduce(
      (sum, receipt) => sum + Math.max(Number(receipt.total) - Number(receipt.amountPaid ?? 0), 0),
      0,
    );
    type ReceivableBucketEntry = {
      receiptId: number;
      amount: number;
      daysOutstanding: number;
      issuedAt: Date | null;
    };
    type ReceivableBucket = {
      customerId: number;
      customerName: string;
      entries: ReceivableBucketEntry[];
    };
    const receivablesByCustomer = new Map<number, ReceivableBucket>();
    const referenceDate = rangeEnd;
    const msPerDay = 24 * 60 * 60 * 1000;
    const calculateDaysOutstanding = (issuedAt: Date | null | undefined) => {
      if (!issuedAt) {
        return 0;
      }
      const diff = referenceDate.getTime() - issuedAt.getTime();
      return diff <= 0 ? 0 : Math.floor(diff / msPerDay);
    };
    const ensureReceivableBucket = (
      customerId: number,
      customerName: string,
    ): ReceivableBucket => {
      if (!receivablesByCustomer.has(customerId)) {
        receivablesByCustomer.set(customerId, {
          customerId,
          customerName,
          entries: [],
        });
      }
      return receivablesByCustomer.get(customerId)!;
    };
    outstandingReceipts.forEach((receipt) => {
      if (!receipt.customerId) {
        return;
      }
      const outstanding = Math.max(
        Number(receipt.total) - Number(receipt.amountPaid ?? 0),
        0,
      );
      if (outstanding <= 0) return;
      const bucket = ensureReceivableBucket(
        receipt.customerId,
        receipt.customer?.name ?? receipt.walkInName ?? "Unknown",
      );
      const issuedAt = receipt.date ? new Date(receipt.date) : null;
      bucket.entries.push({
        receiptId: receipt.id,
        amount: outstanding,
        daysOutstanding: calculateDaysOutstanding(issuedAt),
        issuedAt,
      });
    });
    customerPaymentCredits.forEach((credit, customerId) => {
      if (!receivablesByCustomer.has(customerId)) {
        receivablesByCustomer.set(customerId, {
          customerId,
          customerName: credit.name,
          entries: [],
        });
      }
      const bucket = receivablesByCustomer.get(customerId)!;
      if (bucket.entries.length === 0) {
        return;
      }
      bucket.entries.sort((a, b) => a.daysOutstanding - b.daysOutstanding);
      let remainingCredit = credit.amount;
      for (const entry of bucket.entries) {
        if (remainingCredit <= 0) break;
        const deduction = Math.min(entry.amount, remainingCredit);
        entry.amount -= deduction;
        remainingCredit -= deduction;
      }
      if (remainingCredit > 0) {
        bucket.entries = [];
      } else {
        bucket.entries = bucket.entries.filter((entry) => entry.amount > 0.0001);
      }
    });
    const receivableCustomers = Array.from(receivablesByCustomer.values())
      .map((bucket) => {
        const positiveEntries = bucket.entries.filter((entry) => entry.amount > 0.0001);
        if (positiveEntries.length === 0) {
          return null;
        }
        const outstanding = positiveEntries.reduce((sum, entry) => sum + entry.amount, 0);
        if (outstanding <= 0) {
          return null;
        }
        const overdueOutstanding = positiveEntries
          .filter((entry) => entry.daysOutstanding >= 30)
          .reduce((sum, entry) => sum + entry.amount, 0);
        const maxDaysOutstanding = positiveEntries.reduce(
          (max, entry) => Math.max(max, entry.daysOutstanding),
          0,
        );
        const oldestInvoiceDateDate =
          positiveEntries.reduce<Date | null>((oldest, entry) => {
            if (!entry.issuedAt) return oldest;
            if (!oldest) return entry.issuedAt;
            return entry.issuedAt < oldest ? entry.issuedAt : oldest;
          }, null) ?? null;
        const oldestInvoiceDate = oldestInvoiceDateDate ? oldestInvoiceDateDate.toISOString() : null;
        return {
          customerId: bucket.customerId,
          customerName: bucket.customerName,
          outstanding,
          overdueOutstanding,
          maxDaysOutstanding,
          isOverdue: overdueOutstanding > 0,
          oldestInvoiceDate,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.outstanding - a.outstanding);

    const filteredSales = hasProductFilter
      ? receipts.reduce((sum, receipt) => {
          const relevantItems = receipt.items.filter((item) => productIdSet.has(item.productId));
          const receiptFilteredTotal = relevantItems.reduce(
            (itemSum, item) => itemSum + Number(item.subtotal ?? 0),
            0,
          );
          return sum + receiptFilteredTotal;
        }, 0)
      : totalSales;

    const materialMap = new Map<number, ProductAggregate>();
    const timelineMap = new Map<string, Map<number, ProductAggregate>>();

    receipts.forEach((receipt) => {
      receipt.items.forEach((item) => {
        if (hasProductFilter && !productIdSet.has(item.productId)) {
          return;
        }
        const productId = item.productId;
        const productName = item.product?.name ?? "Unknown";
        const quantity = Number(item.quantity);
        const revenue = Number(item.subtotal ?? 0);

        if (!materialMap.has(productId)) {
          materialMap.set(productId, { productId, productName, quantity: 0, revenue: 0 });
        }
        const materialSlot = materialMap.get(productId)!;
        materialSlot.quantity += quantity;
        materialSlot.revenue += revenue;

        const key = formatPeriodKey(receipt.date, String(groupBy));
        incrementTimeline(timelineMap, key, productId, productName, quantity, revenue);
      });
    });

    const purchaseCostMap = new Map<number, { totalQuantity: number; totalCost: number }>();
    purchaseEntries.forEach((entry) => {
      if (!entry.productId) {
        return;
      }
      const quantity = Number(entry.quantity ?? 0);
      const totalCost =
        entry.totalCost !== null && entry.totalCost !== undefined
          ? Number(entry.totalCost)
          : Number(entry.unitCost ?? 0) * quantity;
      if (!purchaseCostMap.has(entry.productId)) {
        purchaseCostMap.set(entry.productId, { totalQuantity: 0, totalCost: 0 });
      }
      const bucket = purchaseCostMap.get(entry.productId)!;
      if (quantity > 0) {
        bucket.totalQuantity += quantity;
      }
      bucket.totalCost += totalCost;
    });
    const purchaseCostLookup = new Map(purchaseCostMap);

    const getAveragePurchaseCost = (productId: number | null | undefined): number | null => {
      if (!productId) {
        return null;
      }
      const stats = purchaseCostLookup.get(productId);
      if (!stats || stats.totalQuantity <= 0) {
        return null;
      }
      return stats.totalCost / stats.totalQuantity;
    };

    productionCostEntries.forEach((entry) => {
      if (!entry.productId || !entry.product?.isManufactured) {
        return;
      }
      const quantity = Number(entry.quantity ?? 0);
      if (quantity <= 0) {
        return;
      }

      const powderCostPerUnit = getAveragePurchaseCost(entry.powderProductId);
      const cementCostPerUnit = getAveragePurchaseCost(entry.cementProductId);
      const powderCost =
        powderCostPerUnit !== null && entry.powderUsed ? powderCostPerUnit * Number(entry.powderUsed) : 0;
      const cementCost =
        cementCostPerUnit !== null && entry.cementUsed ? cementCostPerUnit * Number(entry.cementUsed) : 0;
      const laborCost = Number(entry.laborAmount ?? 0) + Number(entry.helperLaborAmount ?? 0);
      const productionCost = powderCost + cementCost + laborCost;

      if (!purchaseCostMap.has(entry.productId)) {
        purchaseCostMap.set(entry.productId, { totalQuantity: 0, totalCost: 0 });
      }
      const bucket = purchaseCostMap.get(entry.productId)!;
      bucket.totalQuantity += quantity;
      bucket.totalCost += productionCost;
    });

    const materialSales = Array.from(materialMap.values())
      .map((entry) => {
        const averageSalePrice = entry.quantity > 0 ? entry.revenue / entry.quantity : 0;
        const purchaseStats = purchaseCostMap.get(entry.productId);
        const averageCost =
          purchaseStats && purchaseStats.totalQuantity > 0
            ? purchaseStats.totalCost / purchaseStats.totalQuantity
            : null;
        const profitPerUnit = averageCost !== null ? averageSalePrice - averageCost : null;
        const profitMargin =
          profitPerUnit !== null && averageSalePrice > 0 ? profitPerUnit / averageSalePrice : null;
        return {
          ...entry,
          averageSalePrice,
          averageCost,
          profitPerUnit,
          profitMargin,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    const salesTimeline = Array.from(timelineMap.entries())
      .map(([period, productMap]) => ({
        period,
        products: Array.from(productMap.values())
          .map((entry) => ({
            ...entry,
            averageSalePrice: entry.quantity > 0 ? entry.revenue / entry.quantity : 0,
            averageCost: null,
            profitPerUnit: null,
            profitMargin: null,
          }))
          .sort((a, b) => b.revenue - a.revenue),
      }))
      .sort((a, b) => (a.period < b.period ? -1 : 1));

    const totalPurchaseCost = purchaseEntries.reduce((sum, entry) => sum + Number(entry.totalCost ?? 0), 0);
    const outstandingPayablesTotal = payables.reduce((sum, entry) => sum + Number(entry.totalCost ?? 0), 0);

    const purchasesBySupplier = purchaseEntries.reduce((acc, entry) => {
      const supplierName = entry.supplier?.name ?? "Unknown";
      if (!acc[supplierName]) {
        acc[supplierName] = { supplier: supplierName, totalCost: 0, entries: 0 };
      }
      acc[supplierName].totalCost += Number(entry.totalCost ?? 0);
      acc[supplierName].entries += 1;
      return acc;
    }, {} as Record<string, { supplier: string; totalCost: number; entries: number }>);

    const purchasesByProductMap = purchaseEntries.reduce(
      (acc, entry) => {
        const key = entry.product?.id ?? entry.productId ?? 0;
        const name = entry.product?.name ?? "Unknown";
        if (!acc.has(key)) {
          acc.set(key, {
            productId: key,
            product: name,
            totalCost: 0,
            quantity: 0,
          });
        }
        const bucket = acc.get(key)!;
        const quantity = Number(entry.quantity ?? 0);
        const totalCost =
          entry.totalCost !== null && entry.totalCost !== undefined
            ? Number(entry.totalCost)
            : Number(entry.unitCost ?? 0) * (quantity || 0);
        if (quantity > 0) {
          bucket.quantity += quantity;
        }
        bucket.totalCost += totalCost;
        return acc;
      },
      new Map<
        number,
        {
          productId: number;
          product: string;
          totalCost: number;
          quantity: number;
        }
      >(),
    );

    const purchasesByProduct = Array.from(purchasesByProductMap.values())
      .map((row) => ({
        ...row,
        averageUnitCost: row.quantity > 0 ? row.totalCost / row.quantity : null,
      }))
      .sort((a, b) => b.totalCost - a.totalCost);

    const recentPurchases = purchaseEntries
      .slice()
      .sort((a, b) => {
        const aDate = new Date(a.entryDate ?? a.createdAt).getTime();
        const bDate = new Date(b.entryDate ?? b.createdAt).getTime();
        return bDate - aDate;
      })
      .slice(0, 25)
      .map((entry) => ({
        id: entry.id,
        entryDate: entry.entryDate ?? entry.createdAt,
        supplier: entry.supplier?.name ?? "Unknown",
        product: entry.product?.name ?? "Unknown",
        quantity: Number(entry.quantity ?? 0),
        totalCost:
          entry.totalCost !== null && entry.totalCost !== undefined
            ? Number(entry.totalCost)
            : Number(entry.unitCost ?? 0) * Number(entry.quantity ?? 0),
        isPaid: entry.isPaid,
        tvaEligible: Boolean((entry as any).tvaEligible),
      }));

    const payablesList = payables.map((entry) => ({
      id: entry.id,
      supplier: entry.supplier?.name ?? "Unknown",
      product: entry.product?.name ?? "Unknown",
      entryDate: entry.entryDate,
      quantity: entry.quantity,
      unitCost: entry.unitCost,
      totalCost: entry.totalCost,
    }));

    const debrisProduct = productsSnapshot.find((product) => product.name.trim().toLowerCase() === debrisProductName);
    const debrisOnHand = debrisProduct?.stockQty ?? 0;
    const debrisDroppedVolume = debrisReceipts.reduce((sum, item) => sum + Number(item.quantity), 0);
    const debrisRemoved = debrisData.reduce(
      (acc, entry) => {
        const amount = entry.removalPayment?.amount ?? entry.removalCost ?? 0;
        acc.volume += Number(entry.volume);
        acc.cost += Number(amount);
        return acc;
      },
      { volume: 0, cost: 0 },
    );

    const stoneProductionTotal = stoneProductionEntries.reduce((sum, entry) => sum + Number(entry.quantity), 0);
    const stoneProductionByDateMap = new Map<string, number>();
    stoneProductionEntries.forEach((entry) => {
      const key = formatPeriodKey(entry.entryDate ?? entry.createdAt, String(groupBy));
      stoneProductionByDateMap.set(key, (stoneProductionByDateMap.get(key) ?? 0) + Number(entry.quantity));
    });

    const stoneProductionByDate = Array.from(stoneProductionByDateMap.entries())
      .map(([period, quantity]) => ({ period, quantity }))
      .sort((a, b) => (a.period < b.period ? -1 : 1));

    const stoneProductionDetails = stoneProductionEntries.map((entry) => ({
      id: entry.id,
      date: entry.entryDate ?? entry.createdAt,
      product: entry.product.name,
      quantity: entry.quantity,
    }));

    res.json({
      period: {
        start: rangeStart,
        end: rangeEnd,
        groupBy,
      },
      revenue: {
        totalSales,
        totalCashCollected,
        outstandingAmount,
        averageReceiptValue: receipts.length > 0 ? totalSales / receipts.length : 0,
        filteredSales: hasProductFilter ? filteredSales : undefined,
      },
      materialSales,
      salesTimeline,
      purchases: {
        totalPurchaseCost,
        outstandingPayablesTotal,
        purchasesBySupplier: Object.values(purchasesBySupplier).sort((a, b) => b.totalCost - a.totalCost),
        purchasesByProduct,
        recentPurchases,
        outstanding: payablesList,
      },
      inventory: {
        snapshot: productsSnapshot,
      },
      debris: {
        onHandVolume: debrisOnHand,
        droppedVolume: debrisDroppedVolume,
        removedVolume: debrisRemoved.volume,
        removalCost: debrisRemoved.cost,
      },
      receivables: {
        customers: receivableCustomers,
      },
      stoneProduction: {
        totalUnits: stoneProductionTotal,
        productionByDate: stoneProductionByDate,
        entries: stoneProductionDetails,
      },
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to generate report" });
  }
});

async function getDailyData(query: any) {
  const { date, productIds: productIdsRaw, customerIds: customerIdsRaw } = query;
  if (!date) {
    throw new Error("date query parameter is required");
  }

  const targetDate = new Date(String(date));
  if (Number.isNaN(targetDate.getTime())) {
    throw new Error("Invalid date value");
  }

  const dayStart = toStartOfDay(targetDate);
  const dayEnd = toEndOfDay(targetDate);

  const parsedProductIds =
    typeof productIdsRaw === "string" && productIdsRaw.trim().length > 0
      ? productIdsRaw
          .split(",")
          .map((value) => Number(value.trim()))
          .filter((value) => !Number.isNaN(value))
      : [];
  const hasProductFilter = parsedProductIds.length > 0;
  const productIdSet = new Set(parsedProductIds);

  const parsedCustomerIds =
    typeof customerIdsRaw === "string" && customerIdsRaw.trim().length > 0
      ? customerIdsRaw
          .split(",")
          .map((value) => Number(value.trim()))
          .filter((value) => !Number.isNaN(value))
      : [];
  const hasCustomerFilter = parsedCustomerIds.length > 0;

  const receiptWhere: Prisma.ReceiptWhereInput = {
    date: { gte: dayStart, lte: dayEnd },
    ...(hasCustomerFilter ? { customerId: { in: parsedCustomerIds } } : {}),
    ...(hasProductFilter
      ? {
          items: {
            some: { productId: { in: parsedProductIds } },
          },
        }
      : {}),
  };

  const receipts = await prisma.receipt.findMany({
    where: receiptWhere,
    orderBy: { date: "asc" },
    include: {
      items: { include: { product: true } },
      customer: true,
      driver: true,
      truck: true,
      jobSite: true,
      receiptPayments: {
        include: {
          payment: true,
        },
      },
    },
  });

  const receiptIds = new Set(receipts.map((receipt) => receipt.id));

  const paymentsRaw = await prisma.payment.findMany({
    where: {
      date: {
        gte: dayStart,
        lte: dayEnd,
      },
      ...(hasCustomerFilter
        ? {
            OR: [
              { customerId: { in: parsedCustomerIds } },
              { receipt: { customerId: { in: parsedCustomerIds } } },
            ],
          }
        : {}),
    },
    include: {
      receipt: true,
      customer: true,
      supplier: true,
      payrollEntry: true,
    },
    orderBy: { date: "asc" },
  });

  const payments = hasProductFilter
    ? paymentsRaw.filter((payment) => (payment.receiptId ? receiptIds.has(payment.receiptId) : false))
    : paymentsRaw;

  const purchaseWhere: Prisma.InventoryEntryWhereInput = {
    type: InventoryEntryType.PURCHASE,
    entryDate: { gte: dayStart, lte: dayEnd },
    ...(hasProductFilter ? { productId: { in: parsedProductIds } } : {}),
  };

  const productionWhere: Prisma.InventoryEntryWhereInput = {
    type: InventoryEntryType.PRODUCTION,
    entryDate: { gte: dayStart, lte: dayEnd },
    ...(hasProductFilter ? { productId: { in: parsedProductIds } } : {}),
  };

  const [purchases, productions, dieselLogs, debrisEntries, payrollEntries] = await Promise.all([
    safeQuery(
      () =>
        prisma.inventoryEntry.findMany({
          where: purchaseWhere,
          include: { supplier: true, product: true },
          orderBy: { entryDate: "asc" },
        }),
      [],
    ),
    safeQuery(
      () =>
        prisma.inventoryEntry.findMany({
          where: productionWhere,
          include: { product: true },
          orderBy: { entryDate: "asc" },
        }),
      [],
    ),
    safeQuery(
      () =>
        prisma.dieselLog.findMany({
          where: {
            date: { gte: dayStart, lte: dayEnd },
          },
          include: { truck: true, driver: true },
          orderBy: { date: "asc" },
        }),
      [],
    ),
    safeQuery(
      () =>
        prisma.debrisEntry.findMany({
          where: {
            OR: [
              {
                date: { gte: dayStart, lte: dayEnd },
              },
              {
                removalDate: { gte: dayStart, lte: dayEnd },
              },
            ],
          },
          include: { customer: true, removalPayment: true },
          orderBy: { date: "asc" },
        }),
      [],
    ),
    safeQuery(
      () =>
        prisma.payrollEntry.findMany({
          where: {
            createdAt: {
              gte: dayStart,
              lte: dayEnd,
            },
          },
          include: {
            employee: true,
            helperEmployee: true,
            stoneProduct: true,
            payment: true,
          },
          orderBy: { createdAt: "asc" },
        }),
      [],
    ),
  ]);

  const normalizedReceipts = receipts.map((receipt) => {
    const relevantItems = hasProductFilter ? receipt.items.filter((item) => productIdSet.has(item.productId)) : receipt.items;
    const filteredTotal = relevantItems.reduce((sum, item) => sum + Number(item.subtotal ?? 0), 0);
    return {
      ...receipt,
      items: relevantItems,
      filteredTotal,
    };
  });

  const receiptsCount = normalizedReceipts.length;
  const totalSales = normalizedReceipts.reduce((sum, receipt) => sum + Number(receipt.total), 0);
  const filteredSales = hasProductFilter
    ? normalizedReceipts.reduce((sum, receipt) => sum + (receipt.filteredTotal ?? 0), 0)
    : totalSales;
  const cashCollected = payments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const averageReceiptValue = receiptsCount > 0 ? totalSales / receiptsCount : 0;

  return {
    date: dayStart.toISOString(),
    filters: {
      productIds: parsedProductIds,
      customerIds: parsedCustomerIds,
    },
    totals: {
      receiptsCount,
      totalSales,
      filteredSales,
      cashCollected,
      averageReceiptValue,
    },
    receipts: normalizedReceipts,
    payments,
    inventory: {
      purchases,
      production: productions,
    },
    dieselLogs,
    debris: {
      entries: debrisEntries,
    },
    payrollEntries,
  };
}

router.get("/daily", async (req, res) => {
  try {
    const data = await getDailyData(req.query);
    res.json(data);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to load daily report" });
  }
});

// Printable daily report (PDF)
router.get("/exports/daily-pdf", async (req, res) => {
  try {
    const data = await getDailyData(req.query);

    const doc = new PDFDocument({ margin: 36, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="daily-${(req.query.date as string) ?? "day"}.pdf"`);
    doc.pipe(res);

    const fmtMoney = (n: number) => `$${Number(n).toFixed(2)}`;
    const fmtDate = (d: string | Date) => new Date(d).toLocaleString();

    doc.fontSize(16).text(`Daily report – ${(req.query.date as string) ?? ""}`);
    doc.fontSize(10).fillColor("#555").text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown(0.5).fillColor("#000");

    const receiptTotal = data.totals.totalSales;
    const inflowTypes = new Set<PaymentType>([PaymentType.RECEIPT, PaymentType.CUSTOMER_PAYMENT]);
    const paymentsInTotal = data.payments
      .filter((p) => inflowTypes.has(p.type as PaymentType))
      .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    const paymentsOutTotal = data.payments
      .filter((p) => !inflowTypes.has(p.type as PaymentType))
      .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    const purchaseTotal = data.inventory.purchases.reduce((sum, p) => {
      const computed = p.totalCost ?? (p.unitCost ?? 0) * (p.quantity ?? 0);
      return sum + Number(computed ?? 0);
    }, 0);

    doc.fontSize(11).text(`Receipts: ${data.totals.receiptsCount} • Total ${fmtMoney(receiptTotal)}`);
    doc.text(`Payments in: ${fmtMoney(paymentsInTotal)} • Payments out: ${fmtMoney(paymentsOutTotal)}`);
    doc.text(`Purchases: ${data.inventory.purchases.length} • Total ${fmtMoney(purchaseTotal)}`);
    doc.text(`Production entries: ${data.inventory.production.length}`);

    const renderTable = (title: string, headers: string[], rows: string[][]) => {
      doc.addPage();
      doc.fontSize(12).fillColor("#000").text(title);
      doc.moveDown(0.25);
      doc.fontSize(9).fillColor("#444");
      const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / headers.length;
      const startX = doc.page.margins.left;
      const drawRow = (cells: string[], bold = false) => {
        let x = startX;
        doc.font(bold ? "Helvetica-Bold" : "Helvetica");
        cells.forEach((cell) => {
          doc.text(cell, x, doc.y, { width: colWidth - 4 });
          x += colWidth;
        });
        doc.moveDown(0.6);
      };
      drawRow(headers, true);
      rows.forEach((row) => drawRow(row, false));
    };

    renderTable(
      "Receipts",
      ["No", "Date", "Customer", "Job site", "Total", "Paid"],
      data.receipts.slice(0, 80).map((r) => [
        r.receiptNo ?? `#${r.id}`,
        fmtDate(r.date),
        r.customer?.name ?? r.walkInName ?? "Walk-in",
        r.jobSite?.name ?? "—",
        fmtMoney(Number(r.total ?? 0)),
        fmtMoney(Number(r.amountPaid ?? 0)),
      ]),
    );

    renderTable(
      "Payments",
      ["Date", "Type", "Description", "Amount"],
      data.payments.slice(0, 80).map((p) => [
        fmtDate(p.date),
        p.type,
        p.description ?? p.reference ?? p.customer?.name ?? p.supplier?.name ?? "—",
        fmtMoney(Number(p.amount ?? 0)),
      ]),
    );

    renderTable(
      "Purchases",
      ["Date", "Supplier", "Product", "Qty", "Total", "Paid"],
      data.inventory.purchases.slice(0, 80).map((p) => [
        fmtDate(p.entryDate),
        p.supplier?.name ?? "—",
        p.product?.name ?? "—",
        Number(p.quantity ?? 0).toLocaleString(),
        fmtMoney(Number(p.totalCost ?? 0)),
        fmtMoney(Number(p.amountPaid ?? 0)),
      ]),
    );

    renderTable(
      "Production",
      ["Date", "Product", "Qty", "Labor paid?"],
      data.inventory.production.slice(0, 80).map((p) => [
        fmtDate(p.entryDate),
        p.product?.name ?? "—",
        Number(p.quantity ?? 0).toLocaleString(),
        p.laborPaid ? "Yes" : "No",
      ]),
    );

    doc.end();
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to generate daily PDF" });
  }
});

// Printable daily report (PDF)
router.get("/exports/daily-pdf", async (req, res) => {
  try {
    const dateParam = req.query.date as string | undefined;
    if (!dateParam) {
      return res.status(400).json({ error: "date query parameter is required" });
    }
    const targetDate = new Date(String(dateParam));
    if (Number.isNaN(targetDate.getTime())) {
      return res.status(400).json({ error: "Invalid date value" });
    }
    const { data: daily } = await prisma.$transaction(async () => {
      const response = await fetch(`/reports/daily?date=${encodeURIComponent(dateParam)}`);
      return { data: await response.json() };
    });
    // NOTE: This endpoint is stubbed to avoid network fetch in server; use daily above if implemented.
    res.status(501).json({ error: "Not implemented" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to generate daily PDF" });
  }
});
// --- PDF Exports (compact layout) ---
const createTableRenderer = (doc: PDFKit.PDFDocument) => {
  return (
    headers: string[],
    rows: string[][],
    colWidths: number[],
    aligns?: Array<"left" | "right">,
  ) => {
    const startX = doc.page.margins.left;
    const availableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const totalWidth = colWidths.reduce((sum, w) => sum + w, 0);
    const scale = totalWidth > availableWidth ? availableWidth / totalWidth : 1;
    const scaled = colWidths.map((w) => Math.floor(w * scale));
    const diff = availableWidth - scaled.reduce((sum, w) => sum + w, 0);
    if (diff !== 0 && scaled.length > 0) scaled[scaled.length - 1] += diff;

    const headerHeight = 14;
    const baseRowHeight = 10;

    let currentY = doc.y;

    const ensureSpace = (height: number) => {
      const pageBottom = doc.page.height - doc.page.margins.bottom;
      if (currentY + height > pageBottom) {
        doc.addPage();
        currentY = doc.page.margins.top;
      }
    };

    const drawHeader = () => {
      ensureSpace(headerHeight);
      doc.x = startX;
      doc.save();
      doc.fillColor("#f2f2f2");
      doc.rect(startX, currentY, availableWidth, headerHeight).fill();
      doc.restore();

      doc.font("Helvetica-Bold").fillColor("#000").fontSize(9);
      let x = startX;
      headers.forEach((header, idx) => {
        doc.text(header, x + 3, currentY + 2, { width: scaled[idx] - 6, ellipsis: true, lineBreak: false });
        x += scaled[idx];
      });
      currentY += headerHeight;
    };

    drawHeader();

    doc.font("Helvetica").fontSize(8.5);
    rows.forEach((row, rowIdx) => {
      // compute required height for this row (allow wrapping for notes)
      const cellHeights = row.map((cell, idx) =>
        doc.heightOfString(String(cell ?? ""), {
          width: scaled[idx] - 6,
          align: aligns?.[idx] ?? "left",
        }),
      );
      const rowHeight = Math.max(baseRowHeight, Math.max(...cellHeights) + 4);

      ensureSpace(rowHeight);
      if (rowIdx % 2 === 1) {
        doc.save();
        doc.fillColor("#fbfbfb");
        doc.rect(startX, currentY, availableWidth, rowHeight).fill();
        doc.restore();
      }
      let xPos = startX;
      row.forEach((cell, idx) => {
        const prevY = doc.y;
        doc.fillColor("#000").text(String(cell ?? ""), xPos + 3, currentY + 2, {
          width: scaled[idx] - 6,
          ellipsis: true,
          lineBreak: true,
          align: aligns?.[idx] ?? "left",
        });
        doc.y = prevY; // keep internal cursor stable; we advance manually
        xPos += scaled[idx];
      });
      currentY += rowHeight;
    });

    doc.y = currentY;
    doc.x = startX;
  };
};

router.get("/exports/financial-pdf", async (req, res) => {
  const { start, end } = req.query;
  const endDate = end ? new Date(String(end)) : new Date();
  const startDate = start ? new Date(String(start)) : new Date(endDate.getTime() - 29 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return res.status(400).json({ error: "Invalid start or end date" });
  }
  const rangeStart = toStartOfDay(startDate);
  const rangeEnd = toEndOfDay(endDate);

  try {
    const [payments, products] = await Promise.all([
      prisma.payment.findMany({
        where: { date: { gte: rangeStart, lte: rangeEnd } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        select: {
          id: true,
          date: true,
          amount: true,
          type: true,
          description: true,
          customer: { select: { name: true } },
          supplier: { select: { name: true } },
        },
      }),
      prisma.product.findMany({
        orderBy: [{ name: "asc" }],
        select: { id: true, name: true, unit: true, stockQty: true, unitPrice: true },
      }),
    ]);

    const creditTypes = new Set<PaymentType>([PaymentType.CUSTOMER_PAYMENT, PaymentType.RECEIPT]);
    const paymentLines = payments.map((p) => ({
      ...p,
      direction: creditTypes.has(p.type) ? "credit" : "debit",
      party: p.customer?.name ?? p.supplier?.name ?? "",
    }));

    const creditTotal = paymentLines
      .filter((p) => p.direction === "credit")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const debitTotal = paymentLines
      .filter((p) => p.direction === "debit")
      .reduce((sum, p) => sum + Number(p.amount), 0);
    const inventoryTotalValue = products.reduce(
      (sum, product) => sum + Number(product.unitPrice ?? 0) * Number(product.stockQty ?? 0),
      0,
    );

    const doc = new PDFDocument({ margin: 32, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=\"financial-inventory-report.pdf\"");
    doc.pipe(res);
    const renderTable = createTableRenderer(doc);
    const fmtCurrency = (n: number) => `${n.toFixed(2)}`;
    const fmtDate = (v: Date | string) => {
      const d = typeof v === "string" ? new Date(v) : v;
      return d.toISOString().slice(0, 10);
    };

    doc.fontSize(18).text("Financial & Inventory Report", { align: "left" });
    doc.moveDown(0.2);
    doc.fontSize(10).text(`Range: ${fmtDate(rangeStart)} -> ${fmtDate(rangeEnd)}`);
    doc.moveDown(0.08);

    doc.fontSize(14).text("Credit / Debit Summary");
    doc.moveDown(0.1);
    doc.fontSize(11).text(`Credits: ${fmtCurrency(creditTotal)} | Debits: ${fmtCurrency(debitTotal)}`);
    doc.moveDown(0.2);

    const creditRows = paymentLines
      .filter((p) => p.direction === "credit")
      .slice(0, 80)
      .map((p) => [fmtDate(p.date), fmtCurrency(Number(p.amount)), p.type, p.party ?? "", p.description ?? ""]);
    if (creditRows.length) {
      doc.fontSize(12).text("Credits (in)");
      doc.moveDown(0.04);
      renderTable(["Date", "Amount", "Type", "Party", "Note"], creditRows, [100, 90, 140, 100, 160], [
        "left",
        "right",
        "left",
        "left",
        "left",
      ]);
      doc.moveDown(0.2);
    }

    const debitRows = paymentLines
      .filter((p) => p.direction === "debit")
      .slice(0, 80)
      .map((p) => [fmtDate(p.date), fmtCurrency(Number(p.amount)), p.type, p.party ?? "", p.description ?? ""]);
    if (debitRows.length) {
      doc.fontSize(12).text("Debits (out)");
      doc.moveDown(0.04);
      renderTable(["Date", "Amount", "Type", "Party", "Note"], debitRows, [100, 90, 140, 100, 160], [
        "left",
        "right",
        "left",
        "left",
        "left",
      ]);
      doc.moveDown(0.2);
    }

    doc.fontSize(14).text("Current Inventory");
    doc.moveDown(0.08);
    doc.fontSize(11).text(`Total estimated value: ${fmtCurrency(inventoryTotalValue)}`);
    doc.moveDown(0.04);
    const inventoryRows = products.slice(0, 120).map((product) => {
      const qty = Number(product.stockQty ?? 0);
      const price = Number(product.unitPrice ?? 0);
      const value = qty * price;
      return [product.name, `${qty.toFixed(2)} ${product.unit ?? ""}`, fmtCurrency(price), fmtCurrency(value)];
    });
    renderTable(["Product", "Qty", "Unit price", "Value"], inventoryRows, [240, 90, 90, 110], [
      "left",
      "right",
      "right",
      "right",
    ]);

    doc.end();
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to generate PDF" });
  }
});

router.get("/exports/balances-pdf", async (_req, res) => {
  try {
    const [
      receipts,
      receiptPaymentSums,
      directReceiptPayments,
      payables,
      products,
      manualCustomerOverrides,
      manualSupplierOverrides,
      pairLinks,
      purchasePaidLinks,
    ] = await Promise.all([
      prisma.receipt.findMany({
        where: { customerId: { not: null } },
        select: {
          id: true,
          total: true,
          amountPaid: true,
          isPaid: true,
          customerId: true,
          customer: { select: { name: true } },
        },
      }),
      prisma.receiptPayment.groupBy({
        by: ["receiptId"],
        _sum: { amount: true },
      }),
      prisma.payment.groupBy({
        by: ["receiptId"],
        _sum: { amount: true },
        where: { receiptId: { not: null }, type: { in: [PaymentType.RECEIPT, PaymentType.CUSTOMER_PAYMENT] } },
      }),
      prisma.inventoryEntry.findMany({
        where: { type: InventoryEntryType.PURCHASE, isPaid: false },
        select: {
          id: true,
          supplierId: true,
          supplier: { select: { name: true } },
          totalCost: true,
          unitCost: true,
          quantity: true,
          amountPaid: true,
        },
        orderBy: [{ id: "desc" }],
      }),
      prisma.product.findMany({
        orderBy: [{ name: "asc" }],
        select: { id: true, name: true, stockQty: true, unit: true, unitPrice: true },
      }),
      prisma.customer.findMany({
        where: { manualBalanceOverride: { not: null } },
        select: { id: true, name: true, manualBalanceOverride: true },
      }),
      prisma.supplier.findMany({
        where: { manualBalanceOverride: { not: null } },
        select: { id: true, name: true, manualBalanceOverride: true },
      }),
      (prisma as any).customerSupplierLink?.findMany?.() ?? [],
      safeQuery(
        () =>
          prisma.inventoryPayment.groupBy({
            by: ["inventoryEntryId"],
            _sum: { amount: true },
          }),
        [] as { inventoryEntryId: number; _sum: { amount: number | null } }[],
      ),
    ]);

    // Build name map from receipts; then use outstandingMap (already total per customer)
    const nameMap = new Map<number, string>();
    const invoiceCountMap = new Map<number, number>();
    receipts.forEach((r) => {
      if (!r.customerId) return;
      if (!nameMap.has(r.customerId)) nameMap.set(r.customerId, r.customer?.name ?? "Unknown");
      invoiceCountMap.set(r.customerId, (invoiceCountMap.get(r.customerId) ?? 0) + 1);
    });

    // Compute paid per receipt fresh (links + direct payments) to avoid stale amountPaid
    const paidMap = new Map<number, number>();
    receiptPaymentSums.forEach((r) => paidMap.set(r.receiptId, Number(r._sum.amount ?? 0)));
    directReceiptPayments.forEach((p) => {
      if (p.receiptId === null) return;
      paidMap.set(p.receiptId, (paidMap.get(p.receiptId) ?? 0) + Number(p._sum.amount ?? 0));
    });

    const outstandingMap = new Map<number, number>();
    receipts.forEach((r) => {
      if (!r.customerId) return;
      const paid = Math.max(
        paidMap.get(r.id) ?? 0,
        Number(r.amountPaid ?? 0),
        r.isPaid ? Number(r.total ?? 0) : 0,
      );
      const outstanding = Math.max(Number(r.total ?? 0) - paid, 0);
      outstandingMap.set(r.customerId, (outstandingMap.get(r.customerId) ?? 0) + outstanding);
    });

    const manualCustomerIdSet = new Set(manualCustomerOverrides.map((c) => c.id));

    // Supplier payables with payment links
    const purchasePaidMap = new Map<number, number>();
    purchasePaidLinks.forEach((row) =>
      purchasePaidMap.set(row.inventoryEntryId, Number(row._sum.amount ?? 0)),
    );

    const payableMap = new Map<number, { name: string; outstanding: number; entries: number }>();
    payables.forEach((p) => {
      if (!p.supplierId) return;
      const paid = Math.max(Number(p.amountPaid ?? 0), purchasePaidMap.get(p.id) ?? 0);
      const total = computeInventoryAmount(p as any);
      const outstanding = Math.max(total - paid, 0);
      if (outstanding <= 0) return;
      if (!payableMap.has(p.supplierId)) {
        payableMap.set(p.supplierId, { name: p.supplier?.name ?? "Unknown", outstanding: 0, entries: 0 });
      }
      const bucket = payableMap.get(p.supplierId)!;
      bucket.outstanding += outstanding;
      bucket.entries += 1;
    });

    const manualSupplierIdSet = new Set(manualSupplierOverrides.map((s) => s.id));

    // Apply customer-supplier pairing netting
    pairLinks.forEach((pair: any) => {
      const custOutstanding = outstandingMap.get(pair.customerId) ?? 0;
      const supplierOutstanding = payableMap.get(pair.supplierId)?.outstanding ?? 0;
      const offset = Math.min(custOutstanding, supplierOutstanding);
      if (offset <= 0) return;
      outstandingMap.set(pair.customerId, Math.max(custOutstanding - offset, 0));
      const bucket = payableMap.get(pair.supplierId);
      if (bucket) {
        bucket.outstanding = Math.max(bucket.outstanding - offset, 0);
      }
    });

    const receivableList = Array.from(outstandingMap.entries())
      .filter(([customerId]) => !manualCustomerIdSet.has(customerId))
      .map(([customerId, outstanding]) => ({
        name: nameMap.get(customerId) ?? "Unknown",
        outstanding,
        invoices: invoiceCountMap.get(customerId) ?? 0,
      }))
      .filter((r) => r.outstanding > 0)
      .sort((a, b) => b.outstanding - a.outstanding);

    const manualReceivableList = manualCustomerOverrides.map((c) => ({
      name: c.name,
      outstanding: Number(c.manualBalanceOverride ?? 0),
      invoices: 0,
    }));

    const manualPayableList = manualSupplierOverrides.map((s) => ({
      name: s.name,
      outstanding: Number(s.manualBalanceOverride ?? 0),
      entries: 0,
    }));

    const payableList = Array.from(payableMap.entries())
      .filter(([supplierId]) => !manualSupplierIdSet.has(supplierId))
      .map(([, value]) => value)
      .sort((a, b) => b.outstanding - a.outstanding);

    const totalReceivables =
      receivableList.reduce((sum, r) => sum + r.outstanding, 0) +
      manualReceivableList.reduce((sum, r) => sum + r.outstanding, 0);
    const totalPayables =
      payableList.reduce((sum, p) => sum + p.outstanding, 0) +
      manualPayableList.reduce((sum, p) => sum + p.outstanding, 0);
    const inventoryTotalValue = products.reduce(
      (sum, product) => sum + Number(product.stockQty ?? 0) * Number(product.unitPrice ?? 0),
      0,
    );

    const doc = new PDFDocument({ margin: 32, size: "A4" });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename=\"balances-report.pdf\"");
    doc.pipe(res);
    const renderTable = createTableRenderer(doc);
    const fmtCurrency = (n: number) => `${n.toFixed(2)}`;

    doc.fontSize(18).text("Balances Report", { align: "left" });
    doc.moveDown(0.03);
    doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`);
    doc.moveDown(0.01);
    doc.fontSize(12).text(`Total receivables (customers): ${fmtCurrency(totalReceivables)}`);
    doc.fontSize(12).text(`Total payables (suppliers): ${fmtCurrency(totalPayables)}`);
    doc.fontSize(12).text(`Inventory value (estimated): ${fmtCurrency(inventoryTotalValue)}`);
    doc.moveDown(0.01);

    doc.fontSize(14).text("Customer Receivables");
    doc.moveDown(0.01);
    const receivableRows = receivableList.map((r) => [r.name, r.invoices.toString(), fmtCurrency(r.outstanding)]);
    renderTable(["Customer", "Invoices", "Outstanding"], receivableRows, [260, 80, 140], ["left", "right", "right"]);

    doc.fontSize(14).text("Supplier Payables");
    doc.moveDown(0.01);
    const payableRows = payableList.map((p) => [p.name, p.entries.toString(), fmtCurrency(p.outstanding)]);
    renderTable(["Supplier", "Entries", "Outstanding"], payableRows, [260, 80, 140], ["left", "right", "right"]);

    doc.fontSize(14).text("Current Inventory Snapshot");
    doc.moveDown(0.02);
    const inventoryRows = products.map((product) => {
      const qty = Number(product.stockQty ?? 0);
      const price = Number(product.unitPrice ?? 0);
      const value = qty * price;
      return [product.name, `${qty.toFixed(2)} ${product.unit ?? ""}`, fmtCurrency(price), fmtCurrency(value)];
    });
    renderTable(["Product", "Qty", "Unit price", "Value"], inventoryRows, [260, 90, 90, 110], [
      "left",
      "right",
      "right",
      "right",
    ]);

    doc.end();
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to generate balances PDF" });
  }
});

router.get("/exports/cash-ledger-pdf", async (req, res) => {
  try {
    const startParam = req.query.start as string | undefined;
    const endParam = req.query.end as string | undefined;
    const allTime = req.query.allTime === "true";
    const customerId = req.query.customerId ? Number(req.query.customerId) : undefined;
    const supplierId = req.query.supplierId ? Number(req.query.supplierId) : undefined;
    const productId = req.query.productId ? Number(req.query.productId) : undefined;
    const includeReceipts = req.query.receipts === "true";
    const includeInventory = req.query.inventory === "true";
    const receiptStatusFilter =
      typeof req.query.receiptStatus === "string" ? req.query.receiptStatus.toLowerCase() : "all";

    const startDate = startParam ? new Date(startParam) : undefined;
    const endDate = endParam ? new Date(endParam) : undefined;
    if (startDate && Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "Invalid start date" });
    }
    if (endDate && Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid end date" });
    }

    const range = allTime ? undefined : { start: startDate, end: endDate };
    const ledger = await fetchCashFlows(prisma, range, {
      customerId: customerId && !Number.isNaN(customerId) ? customerId : undefined,
      supplierId: supplierId && !Number.isNaN(supplierId) ? supplierId : undefined,
      productId: productId && !Number.isNaN(productId) ? productId : undefined,
    });

    const typesParam = (req.query.types as string | undefined)?.split(",").map((t) => t.trim()).filter(Boolean);
    const typeFilter = typesParam && typesParam.length > 0 ? new Set(typesParam) : null;
    const inflowsEnabled = req.query.inflows !== "false";
    const outflowsEnabled = req.query.outflows !== "false";

    const filteredInflows = inflowsEnabled
      ? ledger.inflows.filter((row) => !typeFilter || typeFilter.has(String(row.type)))
      : [];
    const filteredOutflows = outflowsEnabled
      ? ledger.outflows.filter((row) => !typeFilter || typeFilter.has(String(row.type)))
      : [];
    const filteredInflowTotal = filteredInflows.reduce((sum, r) => sum + r.amount, 0);
    const filteredOutflowTotal = filteredOutflows.reduce((sum, r) => sum + r.amount, 0);
    const filteredCashOnHand = filteredInflowTotal - filteredOutflowTotal;

    let receiptRows: {
      id: number;
      customerId: number | null;
      date: Date;
      receiptNo: string;
      customer: string;
      type: string;
      total: number;
      paid: number;
      outstanding: number;
      status: string;
      isManual?: boolean;
    }[] = [];
    let inventoryRows: {
      id: number;
      supplierId: number | null;
      date: Date;
      type: string;
      supplier: string;
      quantity: number;
      total: number;
      paid: number;
      outstanding: number;
      isManual?: boolean;
    }[] = [];
    const pairLinks = await safeQuery(
      () => (prisma as any).customerSupplierLink?.findMany() ?? Promise.resolve([]),
      [] as { customerId: number; supplierId: number }[],
    );

    if (includeReceipts) {
      const receiptWhere: Prisma.ReceiptWhereInput = {
        ...(customerId && !Number.isNaN(customerId) ? { customerId } : {}),
        ...(productId && !Number.isNaN(productId)
          ? {
              items: {
                some: { productId },
              },
            }
          : {}),
      };
      if (!allTime) {
        receiptWhere.date = {
          gte: startDate ?? undefined,
          lte: endDate ?? undefined,
        };
      }

      const [receipts, receiptPaymentSums, directReceiptPayments] = await Promise.all([
        prisma.receipt.findMany({
          where: receiptWhere,
          orderBy: [{ date: "desc" }, { id: "desc" }],
          select: {
            id: true,
            receiptNo: true,
            date: true,
            total: true,
            amountPaid: true,
            isPaid: true,
            type: true,
            customerId: true,
            customer: { select: { name: true } },
            walkInName: true,
          },
        }),
        prisma.receiptPayment.groupBy({
          by: ["receiptId"],
          _sum: { amount: true },
        }),
        prisma.payment.groupBy({
          by: ["receiptId"],
          _sum: { amount: true },
          where: { receiptId: { not: null }, type: { in: [PaymentType.RECEIPT, PaymentType.CUSTOMER_PAYMENT] } },
        }),
      ]);

      const paidMap = new Map<number, number>();
      receiptPaymentSums.forEach((r) => paidMap.set(r.receiptId, Number(r._sum.amount ?? 0)));
      directReceiptPayments.forEach((p) => {
        if (p.receiptId === null) return;
        paidMap.set(p.receiptId, (paidMap.get(p.receiptId) ?? 0) + Number(p._sum.amount ?? 0));
      });

      receiptRows = receipts.map((r) => {
        const paidFromLinks = paidMap.get(r.id) ?? 0;
        const paidFlag = r.isPaid ? Number(r.total) : 0;
        const paid = Math.max(paidFromLinks, Number(r.amountPaid ?? 0), paidFlag);
        const outstanding = Math.max(Number(r.total ?? 0) - paid, 0);
        const status = paid >= Number(r.total ?? 0) || r.isPaid ? "Paid" : paid > 0 ? "Partial" : "Unpaid";
        return {
          id: r.id,
          customerId: r.customerId ?? null,
          date: r.date,
          receiptNo: r.receiptNo ?? `#${r.id}`,
          customer: r.customer?.name ?? r.walkInName ?? "Walk-in",
          type: String(r.type ?? "NORMAL"),
          total: Number(r.total ?? 0),
          paid,
          outstanding,
          status,
        };
      });
      if (receiptStatusFilter === "paid") {
        receiptRows = receiptRows.filter((r) => r.status === "Paid");
      } else if (receiptStatusFilter === "unpaid") {
        receiptRows = receiptRows.filter((r) => r.status !== "Paid");
      }
    }

    // Supplier payables + netting with paired accounts (mirror finance)
    const [purchasePayables, purchasePaidLinks] = await Promise.all([
      prisma.inventoryEntry.findMany({
        where: {
          type: InventoryEntryType.PURCHASE,
          isPaid: false,
          ...(supplierId && !Number.isNaN(supplierId) ? { supplierId } : {}),
          ...(productId && !Number.isNaN(productId) ? { productId } : {}),
          ...(range
            ? {
                entryDate: {
                  gte: range.start ?? undefined,
                  lte: range.end ?? undefined,
                },
              }
            : {}),
        },
        include: { supplier: true },
      }),
      safeQuery(
        () =>
          prisma.inventoryPayment.groupBy({
            by: ["inventoryEntryId"],
            _sum: { amount: true },
          }),
        [] as { inventoryEntryId: number; _sum: { amount: number | null } }[],
      ),
    ]);

    const purchasePaidMap = new Map<number, number>();
    purchasePaidLinks.forEach((row) =>
      purchasePaidMap.set(row.inventoryEntryId, Number(row._sum.amount ?? 0)),
    );

    const supplierOutstandingMap = new Map<number, number>();
    purchasePayables.forEach((entry) => {
      const paid = Math.max(Number(entry.amountPaid ?? 0), purchasePaidMap.get(entry.id) ?? 0);
      const outstanding = Math.max(computeInventoryAmount(entry) - paid, 0);
      if (outstanding <= 0) return;
      if (includeInventory) {
        inventoryRows.push({
          id: entry.id,
          supplierId: entry.supplierId ?? null,
          date: entry.entryDate,
          type: String(entry.type),
          supplier: entry.supplier?.name ?? "Unknown supplier",
          quantity: Number(entry.quantity ?? 0),
          total: computeInventoryAmount(entry),
          paid,
          outstanding,
        });
      }
      if (entry.supplierId) {
        supplierOutstandingMap.set(
          entry.supplierId,
          (supplierOutstandingMap.get(entry.supplierId) ?? 0) + outstanding,
        );
      }
    });

    pairLinks.forEach((pair) => {
      const custOutstanding = receiptRows
        .filter((r) => r.customerId === pair.customerId)
        .reduce((sum, r) => sum + r.outstanding, 0);
      const supplierOutstanding = supplierOutstandingMap.get(pair.supplierId) ?? 0;
      const offset = Math.min(custOutstanding, supplierOutstanding);
      if (offset <= 0) return;

      let remaining = offset;
      for (const row of inventoryRows) {
        if (remaining <= 0) break;
        if (row.supplierId === pair.supplierId) {
          const apply = Math.min(row.outstanding, remaining);
          row.outstanding -= apply;
          remaining -= apply;
        }
      }

      let remainingCust = offset;
      for (const row of receiptRows) {
        if (remainingCust <= 0) break;
        if (row.customerId === pair.customerId) {
          const apply = Math.min(row.outstanding, remainingCust);
          row.outstanding -= apply;
          remainingCust -= apply;
        }
      }
    });

    receiptRows = receiptRows.filter((r) => r.outstanding > 0 || r.status !== "Unpaid");
    inventoryRows = inventoryRows.filter((r) => r.outstanding > 0);

    const fmtDate = (d: Date | string, compact = false) =>
      new Date(d).toLocaleDateString(undefined, {
        year: "numeric",
        month: compact ? "2-digit" : "short",
        day: compact ? "2-digit" : "numeric",
      });
    const fmtMoney = (n: number) => `$${n.toFixed(2)}`;
    const slugify = (s: string) =>
      s
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-_]+/g, "");

    const [customerRecord, supplierRecord, productRecord] = await Promise.all([
      customerId && !Number.isNaN(customerId)
        ? prisma.customer.findUnique({ where: { id: customerId }, select: { name: true } })
        : null,
      supplierId && !Number.isNaN(supplierId)
        ? prisma.supplier.findUnique({ where: { id: supplierId }, select: { name: true } })
        : null,
      productId && !Number.isNaN(productId)
        ? prisma.product.findUnique({ where: { id: productId }, select: { name: true } })
        : null,
    ]);

    res.setHeader("Content-Type", "application/pdf");
    const nameParts = ["cash_ledger"];
    if (!allTime) {
      nameParts.push(
        `${startDate ? fmtDate(startDate, true) : "start"}-${endDate ? fmtDate(endDate, true) : "end"}`,
      );
    } else {
      nameParts.push("all-time");
    }
    if (customerId && !Number.isNaN(customerId)) {
      const label = customerRecord?.name ? slugify(customerRecord.name) : String(customerId);
      nameParts.push(`customer-${label}`);
    }
    if (supplierId && !Number.isNaN(supplierId)) {
      const label = supplierRecord?.name ? slugify(supplierRecord.name) : String(supplierId);
      nameParts.push(`supplier-${label}`);
    }
    if (productId && !Number.isNaN(productId)) {
      const label = productRecord?.name ? slugify(productRecord.name) : String(productId);
      nameParts.push(`product-${label}`);
    }
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${nameParts.join("_").replace(/\\s+/g, "-")}.pdf"`,
    );

    const doc = new PDFDocument({ margin: 36, size: "A4" });
    doc.pipe(res);

    doc.fontSize(16).text("Cash Ledger", { continued: false });
    doc.fontSize(10).fillColor("#555");
    if (allTime) {
      doc.text("Range: all time");
    } else {
      doc.text(
        `Range: ${startDate ? fmtDate(startDate) : "—"} to ${endDate ? fmtDate(endDate) : "—"}`,
      );
    }
    doc.moveDown(0.5);
    doc.fillColor("#000").fontSize(12).text(`Cash on hand: ${fmtMoney(filteredCashOnHand)}`);
    doc
      .fontSize(10)
      .text(`Inflows: ${fmtMoney(filteredInflowTotal)} | Outflows: ${fmtMoney(filteredOutflowTotal)}`);

    const renderSection = (
      title: string,
      rows: { date: Date; type: any; label: string; amount: number }[],
      total: number,
    ) => {
      const typeLabel = (t: any) => {
        const map: Record<string, string> = {
          CUSTOMER_PAYMENT: "Customer",
          RECEIPT: "Receipt",
          SUPPLIER: "Supplier",
          GENERAL_EXPENSE: "Expense",
          DEBRIS_REMOVAL: "Debris",
          OWNER_DRAW: "Owner draw",
          PAYROLL_SALARY: "Payroll",
          PAYROLL_PIECEWORK: "Payroll",
          PAYROLL_RUN: "Payroll run",
        };
        return map[String(t)] ?? String(t);
      };

      doc.x = doc.page.margins.left;
      doc.moveDown(1);
      doc.fontSize(12).fillColor("#000").text(title);
      doc.moveDown(0.25);
      doc.fontSize(10).fillColor("#444");
      const colWidths = [90, 120, 220, 90];
      const tableWidth = colWidths.reduce((a, b) => a + b, 0);
      const startX = doc.page.margins.left;
      const headers = ["Date", "Type", "Label", "Amount"];

      const drawHeader = () => {
        const startY = doc.y;
        doc.rect(startX, startY, tableWidth, 18).fill("#f2f2f2");
        doc.fillColor("#000").fontSize(10);
        let x = startX + 4;
        headers.forEach((h, idx) => {
          doc.text(h, x, startY + 4, {
            width: colWidths[idx] - 8,
            align: idx === 3 ? "right" : "left",
          });
          x += colWidths[idx];
        });
        doc.y = startY + 18;
      };

      drawHeader();

      let currentY = doc.y;
      rows.forEach((row) => {
        const rowHeight = 18;
        const bottomLimit = doc.page.height - doc.page.margins.bottom - rowHeight;
        if (currentY > bottomLimit) {
          doc.addPage();
          doc.x = doc.page.margins.left;
          drawHeader();
          currentY = doc.y;
        }
        let x = startX + 4;
        doc.fillColor("#000");
        doc.text(fmtDate(row.date), x, currentY + 3, { width: colWidths[0] - 8 });
        x += colWidths[0];
        doc.text(typeLabel(row.type), x, currentY + 3, { width: colWidths[1] - 8 });
        x += colWidths[1];
        doc.text(row.label, x, currentY + 3, { width: colWidths[2] - 8 });
        x += colWidths[2];
        doc.text(fmtMoney(row.amount), x, currentY + 3, { width: colWidths[3] - 8, align: "right" });
        currentY += rowHeight;
        doc.y = currentY;
      });
      // Footer total row
      const footerHeight = 18;
      const bottomLimit = doc.page.height - doc.page.margins.bottom - footerHeight;
      if (currentY > bottomLimit) {
        doc.addPage();
        doc.x = doc.page.margins.left;
        drawHeader();
        currentY = doc.y;
      }
      doc.fillColor("#000").fontSize(10);
      doc.rect(startX, currentY, tableWidth, footerHeight).fill("#f9f9f9");
      let xFooter = startX + 4;
      doc.text("Total", xFooter, currentY + 4, { width: colWidths[0] + colWidths[1] + colWidths[2] - 8 });
      xFooter = startX + colWidths[0] + colWidths[1] + colWidths[2] + 4;
      doc.text(fmtMoney(total), xFooter, currentY + 4, {
        width: colWidths[3] - 8,
        align: "right",
      });
      currentY += footerHeight;
      doc.y = currentY;
      doc.moveDown(0.5);
    };

    if (filteredInflows.length > 0) {
      renderSection("Inflows", filteredInflows, filteredInflowTotal);
    }
    if (filteredOutflows.length > 0) {
      renderSection("Outflows", filteredOutflows, filteredOutflowTotal);
    }
    if (filteredInflows.length === 0 && filteredOutflows.length === 0) {
      doc.moveDown(1);
      doc.text("No entries match the selected filters.");
    }

    if (receiptRows.length > 0) {
      doc.addPage();
      doc.fontSize(12).fillColor("#000").text("Receipts (paid & unpaid)", { continued: false });
      doc.moveDown(0.25);
      doc.fontSize(9).fillColor("#444");
      // Keep table narrow to prevent overflow on A4 with margins
      const colWidths = [60, 70, 140, 60, 60, 60, 50];
      const tableWidth = colWidths.reduce((a, b) => a + b, 0);
      const startX = doc.page.margins.left;
      const headers = ["Date", "Receipt", "Customer", "Type", "Total", "Paid", "Status"];

      const drawRow = (
        row:
          | {
              date: Date;
              receiptNo: string;
              customer: string;
              type: string;
              total: number;
              paid: number;
              status: string;
            }
          | null,
        isHeader = false,
      ) => {
        const startY = doc.y;
        if (isHeader) {
          doc.rect(startX, startY, tableWidth, 16).fill("#f2f2f2");
          doc.fillColor("#000").fontSize(9);
        } else {
          doc.fillColor("#000").fontSize(8);
        }
        let x = startX + 4;
        const values = isHeader
          ? headers
          : [
              fmtDate(row!.date),
              row!.receiptNo,
              row!.customer,
              row!.type,
              fmtMoney(row!.total),
              fmtMoney(row!.paid),
              row!.status,
            ];
        values.forEach((val, idx) => {
          doc.text(val, x, startY + 3, {
            width: colWidths[idx] - 6,
            align: idx >= 4 ? "right" : "left",
          });
          x += colWidths[idx];
        });
        doc.y = startY + 16;
      };

      drawRow(null, true);
      receiptRows.forEach((row) => {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 24) {
          doc.addPage();
          drawRow(null, true);
        }
        drawRow(row);
      });
    }

    if (inventoryRows.length > 0) {
      doc.addPage();
      doc.fontSize(12).fillColor("#000").text("Inventory entries for product", { continued: false });
      doc.moveDown(0.25);
      doc.fontSize(9).fillColor("#444");
      const colWidths = [70, 70, 120, 70, 60, 60, 60];
      const tableWidth = colWidths.reduce((a, b) => a + b, 0);
      const startX = doc.page.margins.left;
      const headers = ["Date", "Type", "Supplier", "Quantity", "Total", "Paid", "Outstanding"];

      const drawRow = (
        row:
          | {
              date: Date;
              type: string;
              supplier: string;
              quantity: number;
              total: number;
              paid: number;
              outstanding: number;
            }
          | null,
        isHeader = false,
      ) => {
        const startY = doc.y;
        if (isHeader) {
          doc.rect(startX, startY, tableWidth, 16).fill("#f2f2f2");
          doc.fillColor("#000").fontSize(9);
        } else {
          doc.fillColor("#000").fontSize(8);
        }
        let x = startX + 4;
        const values = isHeader
          ? headers
          : [
              fmtDate(row!.date),
              row!.type,
              row!.supplier,
              row!.quantity.toLocaleString(),
              fmtMoney(row!.total),
              fmtMoney(row!.paid),
              fmtMoney(row!.outstanding),
            ];
        values.forEach((val, idx) => {
          doc.text(val, x, startY + 3, {
            width: colWidths[idx] - 6,
            align: idx >= 4 ? "right" : "left",
          });
          x += colWidths[idx];
        });
        doc.y = startY + 16;
      };

      drawRow(null, true);
      inventoryRows.forEach((row) => {
        if (doc.y > doc.page.height - doc.page.margins.bottom - 24) {
          doc.addPage();
          drawRow(null, true);
        }
        drawRow(row);
      });
    }

    doc.end();
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to generate cash ledger PDF" });
  }
});

router.get("/custom", async (req, res) => {
  try {
    const {
      dataset: datasetRaw = "receipts",
      from,
      to,
      groupBy: groupByRaw = "day",
      aggregateBy: aggregateByRaw,
      customerId,
      supplierId,
      jobSiteId,
      productId,
      paymentType,
      receiptType,
      status,
      payrollType,
      inventoryType,
      isPaid,
      limit: limitRaw,
    } = req.query;

    const dataset = String(datasetRaw).toLowerCase();
    const groupBy =
      groupByRaw === "month" || groupByRaw === "week" || groupByRaw === "day"
        ? (groupByRaw as "day" | "week" | "month")
        : "day";
    const aggregateBy = typeof aggregateByRaw === "string" ? aggregateByRaw.toLowerCase() : null;
    const limit = Math.min(Math.max(Number(limitRaw) || 500, 1), 2000);

    const parseDate = (value: unknown): Date | null => {
      if (!value) return null;
      const date = new Date(String(value));
      return Number.isNaN(date.getTime()) ? null : date;
    };
    const fromDate = from ? parseDate(from) : null;
    const toDate = to ? parseDate(to) : null;
    if ((from && !fromDate) || (to && !toDate)) {
      return res.status(400).json({ error: "Invalid from/to dates" });
    }

    const parseNumber = (value: unknown): number | null => {
      if (value === null || value === undefined) return null;
      const parsed = Number(value);
      return Number.isNaN(parsed) ? null : parsed;
    };

    const customerIdNum = parseNumber(customerId);
    const supplierIdNum = parseNumber(supplierId);
    const jobSiteIdNum = parseNumber(jobSiteId);
    const productIdNum = parseNumber(productId);

    const dateFilter =
      fromDate || toDate
        ? {
            gte: fromDate ? toStartOfDay(fromDate) : undefined,
            lte: toDate ? toEndOfDay(toDate) : undefined,
          }
        : undefined;

    const formatKey = (value: Date) => formatPeriodKey(value, groupBy);

    if (dataset === "receipts") {
      const where: Prisma.ReceiptWhereInput = {};
      if (dateFilter) where.date = dateFilter;
      if (customerIdNum) where.customerId = customerIdNum;
      if (jobSiteIdNum) where.jobSiteId = jobSiteIdNum;
      if (receiptType) {
        const normalized = String(receiptType).toUpperCase();
        if (!Object.values(ReceiptType).includes(normalized as ReceiptType)) {
          return res.status(400).json({ error: "Invalid receipt type" });
        }
        where.type = normalized as ReceiptType;
      }
      if (typeof isPaid === "string") {
        if (isPaid === "true") where.isPaid = true;
        else if (isPaid === "false") where.isPaid = false;
      }
      if (productIdNum) {
        where.items = { some: { productId: productIdNum } };
      }

      const receipts = await prisma.receipt.findMany({
        where,
        orderBy: { date: "asc" },
        take: limit,
        include: {
          customer: true,
          jobSite: true,
          items: { include: { product: true } },
          receiptPayments: {
            include: { payment: true },
          },
        },
      });

      const summary = receipts.reduce(
        (acc, receipt) => {
          const paidFromAllocations = (receipt.receiptPayments ?? []).reduce(
            (sum, link) => sum + Number(link.amount ?? 0),
            0,
          );
          const paid = Math.max(Number(receipt.amountPaid ?? 0), paidFromAllocations);
          acc.count += 1;
          acc.total += Number(receipt.total ?? 0);
          acc.amountPaid += paid;
          return acc;
        },
        { count: 0, total: 0, amountPaid: 0 },
      );
      const outstanding = Math.max(summary.total - summary.amountPaid, 0);

      const groups = new Map<
        string,
        { key: string; label?: string; count: number; total: number; amountPaid: number; outstanding: number }
      >();
      const recordGroup = (key: string, label: string | undefined, receipt: any) => {
        if (!groups.has(key)) {
          groups.set(key, { key, label, count: 0, total: 0, amountPaid: 0, outstanding: 0 });
        }
        const bucket = groups.get(key)!;
        const paidFromAllocations = (receipt.receiptPayments ?? []).reduce(
          (sum: number, link: { amount?: number | null }) => sum + Number(link.amount ?? 0),
          0,
        );
        const paid = Math.max(Number(receipt.amountPaid ?? 0), paidFromAllocations);
        const outstandingValue = Math.max(Number(receipt.total ?? 0) - paid, 0);
        bucket.count += 1;
        bucket.total += Number(receipt.total ?? 0);
        bucket.amountPaid += paid;
        bucket.outstanding += outstandingValue;
      };
      receipts.forEach((receipt) => {
        if (aggregateBy === "customer") {
          const label = receipt.customer?.name ?? receipt.walkInName ?? "Walk-in";
          recordGroup(String(receipt.customerId ?? label), label, receipt);
        } else if (aggregateBy === "jobsite" || aggregateBy === "job_site") {
          const label = receipt.jobSite?.name ?? "No site";
          recordGroup(String(receipt.jobSiteId ?? label), label, receipt);
        } else if (aggregateBy === "product") {
          receipt.items.forEach((item: any) => {
            const label = item.product?.name ?? "Unknown product";
            recordGroup(String(item.productId ?? label), label, {
              ...receipt,
              total: item.subtotal ?? 0,
              amountPaid: 0,
              receiptPayments: [],
            });
          });
        } else {
          const key = formatKey(new Date(receipt.date));
          recordGroup(key, key, receipt);
        }
      });

      const items = receipts.map((receipt) => {
        const paidFromAllocations = (receipt.receiptPayments ?? []).reduce(
          (sum, link) => sum + Number(link.amount ?? 0),
          0,
        );
        const paid = Math.max(Number(receipt.amountPaid ?? 0), paidFromAllocations);
        return {
          id: receipt.id,
          receiptNo: receipt.receiptNo,
          date: receipt.date,
          type: receipt.type,
          total: Number(receipt.total ?? 0),
          amountPaid: paid,
          isPaid: receipt.isPaid,
          customer: receipt.customer?.name ?? receipt.walkInName ?? null,
          jobSite: receipt.jobSite?.name ?? null,
          items: receipt.items.map((item) => ({
            product: item.product?.name ?? "Unknown",
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            subtotal: item.subtotal,
          })),
          payments: (receipt.receiptPayments ?? []).map((link) => ({
            id: link.paymentId,
            amount: Number(link.amount ?? 0),
            date: link.payment?.date ?? null,
          })),
        };
      });

      return res.json({
        dataset: "receipts",
        summary: { ...summary, outstanding, average: summary.count ? summary.total / summary.count : 0 },
        groups: Array.from(groups.values()),
        items,
      });
    }

    if (dataset === "payments") {
      const where: Prisma.PaymentWhereInput = {};
      if (dateFilter) where.date = dateFilter;
      if (supplierIdNum) where.supplierId = supplierIdNum;
      if (customerIdNum) where.customerId = customerIdNum;
      if (paymentType) {
        const normalized = String(paymentType).toUpperCase();
        if (!Object.values(PaymentType).includes(normalized as PaymentType)) {
          return res.status(400).json({ error: "Invalid payment type" });
        }
        where.type = normalized as PaymentType;
      }

      const payments = await prisma.payment.findMany({
        where,
        orderBy: { date: "asc" },
        take: limit,
        include: {
          customer: true,
          supplier: true,
          receipt: true,
          payrollEntry: { include: { employee: true } },
          debrisRemoval: true,
        },
      });

      const summary = payments.reduce(
        (acc, payment) => {
          acc.count += 1;
          acc.totalAmount += Number(payment.amount ?? 0);
          return acc;
        },
        { count: 0, totalAmount: 0 },
      );

      const groups = new Map<string, { key: string; label?: string; count: number; totalAmount: number }>();
      payments.forEach((payment) => {
        let key: string;
        let label: string | undefined;
        if (aggregateBy === "customer") {
          key = String(payment.customerId ?? payment.receipt?.customerId ?? payment.customer?.name ?? "customer");
          label = payment.customer?.name ?? "Customer";
        } else if (aggregateBy === "supplier") {
          key = String(payment.supplierId ?? payment.supplier?.name ?? "supplier");
          label = payment.supplier?.name ?? "Supplier";
        } else {
          key = formatKey(new Date(payment.date));
          label = key;
        }
        if (!groups.has(key)) {
          groups.set(key, { key, label, count: 0, totalAmount: 0 });
        }
        const bucket = groups.get(key)!;
        bucket.count += 1;
        bucket.totalAmount += Number(payment.amount ?? 0);
      });

      const items = payments.map((payment) => ({
        id: payment.id,
        date: payment.date,
        amount: Number(payment.amount ?? 0),
        type: payment.type,
        description: payment.description,
        category: payment.category,
        reference: payment.reference,
        customer: payment.customer?.name ?? null,
        supplier: payment.supplier?.name ?? null,
        receiptNo: payment.receipt?.receiptNo ?? null,
        payrollEmployee: payment.payrollEntry?.employee?.name ?? null,
        debrisVolume: payment.debrisRemoval?.volume ?? null,
      }));

      return res.json({
        dataset: "payments",
        summary,
        groups: Array.from(groups.values()),
        items,
      });
    }

    if (dataset === "payroll") {
      const where: Prisma.PayrollEntryWhereInput = {};
      if (dateFilter) where.periodStart = dateFilter;
      if (payrollType) {
        const normalized = String(payrollType).toUpperCase();
        if (!Object.values(PayrollType).includes(normalized as PayrollType)) {
          return res.status(400).json({ error: "Invalid payroll type" });
        }
        where.type = normalized as PayrollType;
      }
      if (customerIdNum) {
        where.employee = { customerId: customerIdNum } as any;
      }

      const entries = await prisma.payrollEntry.findMany({
        where,
        orderBy: { periodStart: "asc" },
        take: limit,
        include: { employee: true, helperEmployee: true, payment: true },
      });

      const summary = entries.reduce(
        (acc, entry) => {
          acc.count += 1;
          acc.totalAmount += Number(entry.amount ?? 0);
          return acc;
        },
        { count: 0, totalAmount: 0 },
      );

      const groups = new Map<string, { key: string; label?: string; count: number; totalAmount: number }>();
      entries.forEach((entry) => {
        let key: string;
        let label: string | undefined;
        if (aggregateBy === "employee") {
          key = String(entry.employeeId);
          label = entry.employee?.name ?? "Employee";
        } else {
          key = formatKey(new Date(entry.periodStart));
          label = key;
        }
        if (!groups.has(key)) {
          groups.set(key, { key, label, count: 0, totalAmount: 0 });
        }
        const bucket = groups.get(key)!;
        bucket.count += 1;
        bucket.totalAmount += Number(entry.amount ?? 0);
      });

      const items = entries.map((entry) => ({
        id: entry.id,
        employee: entry.employee?.name ?? "Unknown",
        helper: entry.helperEmployee?.name ?? null,
        type: entry.type,
        amount: Number(entry.amount ?? 0),
        quantity: entry.quantity,
        periodStart: entry.periodStart,
        periodEnd: entry.periodEnd,
        paidAt: entry.payment?.date ?? null,
      }));

      return res.json({
        dataset: "payroll",
        summary,
        groups: Array.from(groups.values()),
        items,
      });
    }

    if (dataset === "debris") {
      const where: Prisma.DebrisEntryWhereInput = {};
      if (dateFilter) where.date = dateFilter;
      if (customerIdNum) where.customerId = customerIdNum;
      if (status) {
        const normalized = String(status).toUpperCase();
        if (!Object.values(DebrisStatus).includes(normalized as DebrisStatus)) {
          return res.status(400).json({ error: "Invalid debris status" });
        }
        where.status = normalized as DebrisStatus;
      }

      const debrisEntries = await prisma.debrisEntry.findMany({
        where,
        orderBy: { date: "asc" },
        take: limit,
        include: {
          customer: true,
          removalPayment: true,
        },
      });

      const summary = debrisEntries.reduce(
        (acc, entry) => {
          acc.count += 1;
          acc.totalVolume += Number(entry.volume ?? 0);
          acc.totalRemovalCost += Number(entry.removalCost ?? 0);
          return acc;
        },
        { count: 0, totalVolume: 0, totalRemovalCost: 0 },
      );

      const groups = new Map<
        string,
        { key: string; label?: string; count: number; totalVolume: number; totalRemovalCost: number }
      >();
      debrisEntries.forEach((entry) => {
        let key: string;
        let label: string | undefined;
        if (aggregateBy === "customer") {
          key = String(entry.customerId ?? entry.walkInName ?? "walk-in");
          label = entry.customer?.name ?? entry.walkInName ?? "Walk-in";
        } else {
          key = formatKey(new Date(entry.date));
          label = key;
        }
        if (!groups.has(key)) {
          groups.set(key, { key, label, count: 0, totalVolume: 0, totalRemovalCost: 0 });
        }
        const bucket = groups.get(key)!;
        bucket.count += 1;
        bucket.totalVolume += Number(entry.volume ?? 0);
        bucket.totalRemovalCost += Number(entry.removalCost ?? 0);
      });

      const items = debrisEntries.map((entry) => ({
        id: entry.id,
        date: entry.date,
        status: entry.status,
        volume: Number(entry.volume ?? 0),
        removalCost: entry.removalCost,
        removalDate: entry.removalDate,
        customer: entry.customer?.name ?? entry.walkInName ?? null,
        removalPaymentId: entry.removalPaymentId ?? null,
      }));

      return res.json({
        dataset: "debris",
        summary,
        groups: Array.from(groups.values()),
        items,
      });
    }

    if (dataset === "inventory") {
      const where: Prisma.InventoryEntryWhereInput = {};
      if (dateFilter) where.entryDate = dateFilter;
      if (supplierIdNum) where.supplierId = supplierIdNum;
      if (productIdNum) where.productId = productIdNum;
      if (inventoryType) {
        const normalized = String(inventoryType).toUpperCase();
        if (!Object.values(InventoryEntryType).includes(normalized as InventoryEntryType)) {
          return res.status(400).json({ error: "Invalid inventory type" });
        }
        where.type = normalized as InventoryEntryType;
      }
      if (typeof isPaid === "string") {
        if (isPaid === "true") where.isPaid = true;
        else if (isPaid === "false") where.isPaid = false;
      }

      const entries = await prisma.inventoryEntry.findMany({
        where,
        orderBy: { entryDate: "asc" },
        take: limit,
        include: {
          supplier: true,
          product: true,
        },
      });

      const summary = entries.reduce(
        (acc, entry) => {
          acc.count += 1;
          acc.totalCost += Number(entry.totalCost ?? 0);
          acc.totalQuantity += Number(entry.quantity ?? 0);
          return acc;
        },
        { count: 0, totalCost: 0, totalQuantity: 0 },
      );

      const groups = new Map<
        string,
        { key: string; label?: string; count: number; totalCost: number; totalQuantity: number }
      >();
      entries.forEach((entry) => {
        let key: string;
        let label: string | undefined;
        if (aggregateBy === "supplier") {
          key = String(entry.supplierId ?? entry.supplier?.name ?? "supplier");
          label = entry.supplier?.name ?? "Supplier";
        } else if (aggregateBy === "product") {
          key = String(entry.productId ?? entry.product?.name ?? "product");
          label = entry.product?.name ?? "Product";
        } else {
          key = formatKey(new Date(entry.entryDate));
          label = key;
        }
        if (!groups.has(key)) {
          groups.set(key, { key, label, count: 0, totalCost: 0, totalQuantity: 0 });
        }
        const bucket = groups.get(key)!;
        bucket.count += 1;
        bucket.totalCost += Number(entry.totalCost ?? 0);
        bucket.totalQuantity += Number(entry.quantity ?? 0);
      });

      const items = entries.map((entry) => ({
        id: entry.id,
        entryDate: entry.entryDate,
        type: entry.type,
        supplier: entry.supplier?.name ?? null,
        product: entry.product?.name ?? "Unknown",
        quantity: Number(entry.quantity ?? 0),
        totalCost: entry.totalCost,
        isPaid: entry.isPaid,
      }));

      return res.json({
        dataset: "inventory",
        summary,
        groups: Array.from(groups.values()),
        items,
      });
    }

    return res.status(400).json({ error: "Unknown dataset" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to build custom report" });
  }
});

export default router;
