import { Router } from "express";
import { AdminOverrideCategory, InventoryEntryType, PaymentType, Prisma } from "@prisma/client";
import PDFDocument from "pdfkit";
import prisma from "../prismaClient";
import { fetchCashFlows, computeInventoryAmount } from "../utils/cashFlows";

const router = Router();

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

router.get("/overview", async (req, res) => {
  try {
    const {
      start,
      end,
      allTime,
      customerId: customerIdRaw,
      supplierId: supplierIdRaw,
      productId: productIdRaw,
    } = req.query;
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

    const manualOverrideCategories = [
      AdminOverrideCategory.INVENTORY_VALUE,
      AdminOverrideCategory.RECEIVABLES_TOTAL,
      AdminOverrideCategory.PAYABLES_TOTAL,
    ];

    const parsedCustomerId =
      typeof customerIdRaw === "string" && customerIdRaw.trim().length > 0
        ? Number(customerIdRaw)
        : undefined;
    const parsedSupplierId =
      typeof supplierIdRaw === "string" && supplierIdRaw.trim().length > 0
        ? Number(supplierIdRaw)
        : undefined;
    const parsedProductId =
      typeof productIdRaw === "string" && productIdRaw.trim().length > 0
        ? Number(productIdRaw)
        : undefined;
    if (parsedCustomerId !== undefined && Number.isNaN(parsedCustomerId)) {
      return res.status(400).json({ error: "Invalid customerId" });
    }
    if (parsedSupplierId !== undefined && Number.isNaN(parsedSupplierId)) {
      return res.status(400).json({ error: "Invalid supplierId" });
    }
    if (parsedProductId !== undefined && Number.isNaN(parsedProductId)) {
      return res.status(400).json({ error: "Invalid productId" });
    }

    const [
      cashSummary,
      outstandingReceipts,
      receiptPaymentSums,
      directReceiptPayments,
      purchasePayables,
      laborPayables,
      payrollOutstanding,
      inventoryProducts,
      manualOverrides,
      manualCustomerOverrides,
      manualSupplierOverrides,
      customerReceiptDetail,
      supplierPurchaseDetail,
      displaySettings,
    ] = await Promise.all([
      fetchCashFlows(prisma, range, {
        customerId: parsedCustomerId,
        supplierId: parsedSupplierId,
        productId: parsedProductId,
      }),
      prisma.receipt.findMany({
        where: {
          customerId: { not: null },
          ...(parsedCustomerId ? { customerId: parsedCustomerId } : {}),
          ...(parsedProductId
            ? {
                items: {
                  some: { productId: parsedProductId },
                },
              }
            : {}),
          ...(range
            ? {
                date: {
                  gte: range.start ?? undefined,
                  lte: range.end ?? undefined,
                },
              }
            : {}),
        },
        orderBy: { date: "asc" },
        select: {
          id: true,
          receiptNo: true,
          total: true,
          amountPaid: true,
          isPaid: true,
          date: true,
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
        where: {
          receiptId: { not: null },
          type: { in: [PaymentType.RECEIPT, PaymentType.CUSTOMER_PAYMENT] },
        },
      }),
      prisma.inventoryEntry.findMany({
        where: {
          type: InventoryEntryType.PURCHASE,
          isPaid: false,
          ...(parsedSupplierId ? { supplierId: parsedSupplierId } : {}),
          ...(parsedProductId ? { productId: parsedProductId } : {}),
        },
        orderBy: { entryDate: "asc" },
        select: {
          id: true,
          entryDate: true,
          totalCost: true,
          unitCost: true,
          quantity: true,
          amountPaid: true,
          supplierId: true,
          supplier: true,
          product: true,
        },
      }),
      prisma.inventoryEntry.findMany({
        where: {
          type: InventoryEntryType.PRODUCTION,
          laborPaid: false,
          OR: [
            { laborAmount: { not: null } },
            { helperLaborAmount: { not: null } },
          ],
        },
        orderBy: { entryDate: "asc" },
        include: {
          product: true,
          workerEmployee: true,
          helperEmployee: true,
        },
      }),
      prisma.payrollEntry.findMany({
        where: { paymentId: null },
        orderBy: { createdAt: "asc" },
        include: {
          employee: true,
          stoneProduct: true,
        },
      }),
      prisma.product.findMany({
        select: {
          id: true,
          stockQty: true,
          unitPrice: true,
        },
      }),
      prisma.adminOverride.findMany({
        where: {
          category: {
            in: manualOverrideCategories,
          },
        },
      }),
      prisma.customer.findMany({
        where: { manualBalanceOverride: { not: null } },
        select: {
          id: true,
          name: true,
          manualBalanceOverride: true,
          manualBalanceNote: true,
          manualBalanceUpdatedAt: true,
        },
      }),
      prisma.supplier.findMany({
        where: { manualBalanceOverride: { not: null } },
        select: {
          id: true,
          name: true,
          manualBalanceOverride: true,
          manualBalanceNote: true,
          manualBalanceUpdatedAt: true,
        },
      }),
      parsedCustomerId
        ? prisma.receipt.findMany({
            where: {
              customerId: parsedCustomerId,
              ...(parsedProductId
                ? {
                    items: {
                      some: { productId: parsedProductId },
                    },
                  }
                : {}),
              ...(range
                ? {
                    date: {
                      gte: range.start ?? undefined,
                      lte: range.end ?? undefined,
                    },
                  }
                : {}),
            },
            orderBy: [{ date: "desc" }, { id: "desc" }],
            select: {
              id: true,
              receiptNo: true,
              date: true,
              total: true,
              amountPaid: true,
              isPaid: true,
              type: true,
            },
          })
        : [],
      parsedSupplierId
        ? prisma.inventoryEntry.findMany({
            where: {
              type: InventoryEntryType.PURCHASE,
              supplierId: parsedSupplierId,
              ...(parsedProductId ? { productId: parsedProductId } : {}),
              ...(range
                ? {
                    entryDate: {
                      gte: range.start ?? undefined,
                      lte: range.end ?? undefined,
                    },
                  }
                : {}),
            },
            orderBy: [{ entryDate: "desc" }, { id: "desc" }],
            select: {
              id: true,
              entryDate: true,
              quantity: true,
              unitCost: true,
              totalCost: true,
              amountPaid: true,
              isPaid: true,
              product: { select: { name: true } },
            },
          })
        : [],
      prisma.displaySettings.findUnique({ where: { id: 1 } }),
    ]);

    const pairLinks =
      (prisma as any).customerSupplierLink && typeof (prisma as any).customerSupplierLink.findMany === "function"
        ? await (prisma as any).customerSupplierLink.findMany()
        : [];

    const { inflows, outflows, inflowTotal, outflowTotal, cashOnHand } = cashSummary;
    const pairLinksTyped = (pairLinks ?? []) as { customerId: number; supplierId: number }[];

    const filteredManualCustomers = parsedCustomerId
      ? manualCustomerOverrides.filter((customer) => customer.id === parsedCustomerId)
      : parsedProductId
        ? []
        : manualCustomerOverrides;
    const filteredManualSuppliers = parsedSupplierId
      ? manualSupplierOverrides.filter((supplier) => supplier.id === parsedSupplierId)
      : parsedProductId
        ? []
        : manualSupplierOverrides;

    const manualCustomerIdSet = new Set(filteredManualCustomers.map((customer) => customer.id));
    const manualSupplierIdSet = new Set(filteredManualSuppliers.map((supplier) => supplier.id));

    const filteredOutstandingReceipts =
      parsedSupplierId && !parsedCustomerId
        ? []
        : outstandingReceipts.filter((receipt) => {
            if (!receipt.customerId) return true;
            return !manualCustomerIdSet.has(receipt.customerId);
          });

    // Recompute paid per receipt using links + direct payments (receiptId) to avoid stale fields.
    const paidMap = new Map<number, number>();
    receiptPaymentSums.forEach((r) => paidMap.set(r.receiptId, Number(r._sum.amount ?? 0)));
    directReceiptPayments.forEach((p) => {
      if (p.receiptId === null) return;
      paidMap.set(p.receiptId, (paidMap.get(p.receiptId) ?? 0) + Number(p._sum.amount ?? 0));
    });

    const normalizePaid = (receipt: (typeof outstandingReceipts)[number]) => {
      const linkedPaid = paidMap.get(receipt.id) ?? 0;
      const amountPaidField = Number(receipt.amountPaid ?? 0);
      const paidFromFlag = receipt.isPaid ? Number(receipt.total) : 0;
      return Math.max(linkedPaid, amountPaidField, paidFromFlag);
    };

    type ReceivableInternal = {
      id: number;
      receiptNo: string;
      customer: string;
      date: Date;
      total: number;
      outstanding: number;
      isManual: boolean;
      note: string | null;
      customerId: number | null;
    };

    const outstandingMap = new Map<number, number>();
    const receivableEntries: ReceivableInternal[] =
      parsedSupplierId && !parsedCustomerId
        ? []
        : filteredOutstandingReceipts
            .map((receipt) => {
              const paid = normalizePaid(receipt);
              const outstanding = Math.max(Number(receipt.total) - paid, 0);
              if (receipt.customerId) {
                outstandingMap.set(
                  receipt.customerId,
                  (outstandingMap.get(receipt.customerId) ?? 0) + outstanding,
                );
              }
              return {
                id: receipt.id,
                receiptNo: receipt.receiptNo ?? `#${receipt.id}`,
                customer: receipt.customer?.name ?? receipt.walkInName ?? "Walk-in",
                date: receipt.date,
                total: Number(receipt.total),
                outstanding,
                isManual: false,
                note: null,
                customerId: receipt.customerId ?? null,
              };
            })
            .filter((r) => r.outstanding > 0);

    const manualReceivableEntries =
      parsedSupplierId && !parsedCustomerId
        ? []
        : filteredManualCustomers.map((customer) => ({
            id: -customer.id,
            receiptNo: "Manual override",
            customer: customer.name,
            date: customer.manualBalanceUpdatedAt ?? new Date(),
            total: Number(customer.manualBalanceOverride ?? 0),
            outstanding: Number(customer.manualBalanceOverride ?? 0),
            isManual: true,
            note: customer.manualBalanceNote ?? null,
            customerId: customer.id,
          }));

    const filteredPurchasePayables =
      parsedCustomerId && !parsedSupplierId
        ? []
        : purchasePayables.filter((entry) => {
            if (!entry.supplierId) return true;
            return !manualSupplierIdSet.has(entry.supplierId);
          });

    // Paid map for supplier purchases from InventoryPayment links (if present)
    const purchasePaidMap = new Map<number, number>();
    try {
      const linkSums = await prisma.inventoryPayment.groupBy({
        by: ["inventoryEntryId"],
        _sum: { amount: true },
      });
      linkSums.forEach((r) => purchasePaidMap.set(r.inventoryEntryId, Number(r._sum.amount ?? 0)));
    } catch {
      // ignore if table not present
    }

    type PurchasePayableInternal = {
      id: number;
      supplier: string;
      product: string;
      date: Date;
      amount: number;
      isManual: boolean;
      note: string | null;
      supplierId: number | null;
    };

    const purchasePayableEntries: PurchasePayableInternal[] = filteredPurchasePayables
      .map((entry) => {
        const paid = Math.max(Number(entry.amountPaid ?? 0), purchasePaidMap.get(entry.id) ?? 0);
        const outstanding = Math.max(computeInventoryAmount(entry) - paid, 0);
        return {
          id: entry.id,
          supplier: entry.supplier?.name ?? "Unknown supplier",
          product: entry.product?.name ?? "Inventory",
          date: entry.entryDate,
          amount: outstanding,
          isManual: false,
          note: null,
          supplierId: entry.supplierId ?? null,
        };
      })
      .filter((e) => e.amount > 0);

    const manualSupplierEntries =
      parsedProductId && !parsedSupplierId
        ? []
        : filteredManualSuppliers.map((supplier) => ({
            id: -supplier.id,
            supplier: supplier.name,
            product: "Manual override",
            date: supplier.manualBalanceUpdatedAt ?? new Date(),
            amount: Number(supplier.manualBalanceOverride ?? 0),
            isManual: true,
            note: supplier.manualBalanceNote ?? null,
            supplierId: supplier.id,
          }));

    // Net paired customer/supplier balances (one balance when paired)
    const supplierOutstandingMap = new Map<number, number>();
    [...purchasePayableEntries, ...manualSupplierEntries].forEach((entry) => {
      if (!entry.supplierId) return;
      supplierOutstandingMap.set(
        entry.supplierId,
        (supplierOutstandingMap.get(entry.supplierId) ?? 0) + entry.amount,
      );
    });

    pairLinksTyped.forEach((pair) => {
      const custOutstanding = outstandingMap.get(pair.customerId) ?? 0;
      const supplierOutstanding = supplierOutstandingMap.get(pair.supplierId) ?? 0;
      const offset = Math.min(custOutstanding, supplierOutstanding);
      if (offset <= 0) return;

      // Apply offset against supplier payables entries
      let remaining = offset;
      for (const entry of purchasePayableEntries) {
        if (remaining <= 0) break;
        if (entry.supplierId === pair.supplierId) {
          const apply = Math.min(entry.amount, remaining);
          entry.amount -= apply;
          remaining -= apply;
        }
      }
      // Apply offset against customer receivable entries (skip manual overrides)
      let remainingReceivable = offset;
      for (const entry of receivableEntries) {
        if (remainingReceivable <= 0) break;
        if (entry.customerId === pair.customerId && !entry.isManual) {
          const apply = Math.min(entry.outstanding, remainingReceivable);
          entry.outstanding -= apply;
          remainingReceivable -= apply;
        }
      }
      for (const entry of manualReceivableEntries) {
        if (remainingReceivable <= 0) break;
        if (entry.customerId === pair.customerId) {
          const apply = Math.min(entry.outstanding, remainingReceivable);
          entry.outstanding -= apply;
          remainingReceivable -= apply;
        }
      }
    });

    // Recompute maps/totals after pairing offsets
    const recomputedOutstandingMap = new Map<number, number>();
    receivableEntries.forEach((entry) => {
      if (!entry.customerId) return;
      recomputedOutstandingMap.set(
        entry.customerId,
        (recomputedOutstandingMap.get(entry.customerId) ?? 0) + entry.outstanding,
      );
    });

    // Sum outstanding per customer from the map (avoids multiplying by receipt count)
    const receivablesTotal =
      recomputedOutstandingMap.size > 0
        ? Array.from(recomputedOutstandingMap.values()).reduce((sum, v) => sum + v, 0) +
          manualReceivableEntries.reduce((sum, entry) => sum + entry.outstanding, 0)
        : manualReceivableEntries.reduce((sum, entry) => sum + entry.outstanding, 0);

    const receivableEntriesFiltered = receivableEntries.filter(
      (entry) => entry.isManual || entry.outstanding > 0,
    );
    const purchasePayableEntriesFiltered = purchasePayableEntries.filter((entry) => entry.amount > 0);

    const purchasePayablesTotal = [...purchasePayableEntriesFiltered, ...manualSupplierEntries]
      .map((entry) => entry.amount)
      .reduce((sum, amount) => sum + amount, 0);

    const laborSource = parsedCustomerId || parsedSupplierId ? [] : laborPayables;
    const laborPayableEntries = laborSource.map((entry) => {
      const worker = Number(entry.laborAmount ?? 0);
      const helper = Number(entry.helperLaborAmount ?? 0);
      return {
        id: entry.id,
        product: entry.product?.name ?? "Manufactured product",
        date: entry.entryDate,
        quantity: entry.quantity,
        workerDue: worker,
        helperDue: helper,
        total: worker + helper,
        workerName: entry.workerEmployee?.name ?? null,
        helperName: entry.helperEmployee?.name ?? null,
        productionSite: entry.productionSite ?? null,
      };
    });
    const laborPayablesTotal = laborPayableEntries.reduce((sum, entry) => sum + entry.total, 0);

    const payrollSource = parsedCustomerId || parsedSupplierId ? [] : payrollOutstanding;
    const payrollPayableEntries = payrollSource.map((entry) => ({
      id: entry.id,
      employee: entry.employee?.name ?? "Employee",
      amount: Number(entry.amount),
      periodStart: entry.periodStart,
      periodEnd: entry.periodEnd,
      product: entry.stoneProduct?.name ?? null,
    }));
    const payrollPayablesTotal = payrollPayableEntries.reduce((sum, entry) => sum + entry.amount, 0);

    const computedReceivablesTotal = receivablesTotal;
    const computedPayablesTotal = purchasePayablesTotal + laborPayablesTotal + payrollPayablesTotal;
    const computedInventoryValue = inventoryProducts.reduce((sum, product) => {
      const unitPrice = Number(product.unitPrice ?? 0);
      const stockQty = Number(product.stockQty ?? 0);
      return sum + unitPrice * stockQty;
    }, 0);

    const overrideMap = new Map<AdminOverrideCategory, number>();
    manualOverrides.forEach((override) => {
      overrideMap.set(override.category, override.value);
    });

    const inventoryOverride = overrideMap.get(AdminOverrideCategory.INVENTORY_VALUE) ?? null;
    const receivablesOverride = parsedProductId ? null : overrideMap.get(AdminOverrideCategory.RECEIVABLES_TOTAL) ?? null;
    const payablesOverride = parsedProductId ? null : overrideMap.get(AdminOverrideCategory.PAYABLES_TOTAL) ?? null;

    const appliedInventoryTotal = inventoryOverride ?? computedInventoryValue;
    const appliedReceivablesTotal = receivablesOverride ?? computedReceivablesTotal;
    const appliedPayablesTotal = payablesOverride ?? computedPayablesTotal;

    const receivableDisplayEntries = [...receivableEntriesFiltered, ...manualReceivableEntries];
    const purchaseDisplayEntries = [...purchasePayableEntriesFiltered, ...manualSupplierEntries];

    const customerReceiptDetails = parsedCustomerId
      ? customerReceiptDetail.map((receipt) => {
          const paid = normalizePaid(receipt as any);
          const outstanding = Math.max(Number(receipt.total) - paid, 0);
          return {
            id: receipt.id,
            receiptNo: receipt.receiptNo ?? `#${receipt.id}`,
            date: receipt.date,
            total: Number(receipt.total),
            paid,
            outstanding,
            type: receipt.type,
            isPaid: receipt.isPaid,
          };
        })
      : [];

    const supplierPurchaseDetails = parsedSupplierId
      ? supplierPurchaseDetail.map((entry) => {
          const total = computeInventoryAmount({
            ...entry,
            totalCost: entry.totalCost ?? undefined,
            unitCost: entry.unitCost ?? undefined,
          } as any);
          const paid = Math.max(Number(entry.amountPaid ?? 0), purchasePaidMap.get(entry.id) ?? 0);
          const outstanding = Math.max(total - paid, 0);
          return {
            id: entry.id,
            product: entry.product?.name ?? "Inventory",
            date: entry.entryDate,
            total,
            paid,
            outstanding,
            isPaid: entry.isPaid,
          };
        })
      : [];

    const flags = {
      displayCash: (displaySettings as any)?.displayCash ?? true,
      displayReceivables: (displaySettings as any)?.displayReceivables ?? true,
      displayPayables: (displaySettings as any)?.displayPayables ?? true,
      includeReceipts: (displaySettings as any)?.includeReceipts ?? true,
      includeSupplierPurchases: (displaySettings as any)?.includeSupplierPurchases ?? true,
      includeManufacturing: (displaySettings as any)?.includeManufacturing ?? true,
      includePayroll: (displaySettings as any)?.includePayroll ?? true,
      includeDebris: (displaySettings as any)?.includeDebris ?? true,
      includeGeneralExpenses: (displaySettings as any)?.includeGeneralExpenses ?? true,
      includeInventoryValue: (displaySettings as any)?.includeInventoryValue ?? true,
    };

    const filteredInflowsData = flags.includeReceipts
      ? inflows
      : inflows.filter((entry) => entry.type !== PaymentType.RECEIPT && entry.type !== PaymentType.CUSTOMER_PAYMENT);
    const filteredOutflowsData = outflows.filter((entry) => {
      if (!flags.includeDebris && entry.type === PaymentType.DEBRIS_REMOVAL) return false;
      if (!flags.includeGeneralExpenses && (entry.type === PaymentType.GENERAL_EXPENSE || entry.type === PaymentType.OWNER_DRAW))
        return false;
      if (!flags.includePayroll && (entry.type === PaymentType.PAYROLL_SALARY || entry.type === PaymentType.PAYROLL_PIECEWORK || entry.type === PaymentType.PAYROLL_RUN))
        return false;
      if (!flags.includeSupplierPurchases && entry.type === PaymentType.SUPPLIER) return false;
      return true;
    });

    const inflowTotalFiltered = filteredInflowsData.reduce((sum, entry) => sum + entry.amount, 0);
    const outflowTotalFiltered = filteredOutflowsData.reduce((sum, entry) => sum + entry.amount, 0);

    res.json({
      cash: {
        onHand: flags.displayCash ? inflowTotalFiltered - outflowTotalFiltered : 0,
        inflowTotal: flags.displayCash ? inflowTotalFiltered : 0,
        outflowTotal: flags.displayCash ? outflowTotalFiltered : 0,
        inflows: flags.displayCash ? filteredInflowsData : [],
        outflows: flags.displayCash ? filteredOutflowsData : [],
      },
      receivables: {
        total: flags.displayReceivables && flags.includeReceipts ? appliedReceivablesTotal : 0,
        computedTotal: flags.displayReceivables && flags.includeReceipts ? computedReceivablesTotal : 0,
        overrideValue: flags.displayReceivables && flags.includeReceipts ? receivablesOverride : null,
        receipts: flags.displayReceivables && flags.includeReceipts ? receivableDisplayEntries : [],
      },
      payables: {
        total: flags.displayPayables
          ? (flags.includeSupplierPurchases ? purchasePayablesTotal : 0) +
            (flags.includeManufacturing ? laborPayablesTotal : 0) +
            (flags.includePayroll ? payrollPayablesTotal : 0)
          : 0,
        purchaseTotal: flags.displayPayables && flags.includeSupplierPurchases ? purchasePayablesTotal : 0,
        laborTotal: flags.displayPayables && flags.includeManufacturing ? laborPayablesTotal : 0,
        payrollTotal: flags.displayPayables && flags.includePayroll ? payrollPayablesTotal : 0,
        computedTotal: flags.displayPayables
          ? (flags.includeSupplierPurchases ? purchasePayablesTotal : 0) +
            (flags.includeManufacturing ? laborPayablesTotal : 0) +
            (flags.includePayroll ? payrollPayablesTotal : 0)
          : 0,
        overrideValue: flags.displayPayables ? payablesOverride : null,
        purchases: flags.displayPayables && flags.includeSupplierPurchases ? purchaseDisplayEntries : [],
        labor: flags.displayPayables && flags.includeManufacturing ? laborPayableEntries : [],
        payroll: flags.displayPayables && flags.includePayroll ? payrollPayableEntries : [],
      },
      inventory: {
        total: flags.includeInventoryValue ? appliedInventoryTotal : 0,
        computedTotal: flags.includeInventoryValue ? computedInventoryValue : 0,
        overrideValue: flags.includeInventoryValue ? inventoryOverride : null,
      },
      details: {
        customerReceipts: customerReceiptDetails,
        supplierPurchases: supplierPurchaseDetails,
      },
      displayFlags: flags,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to load finance overview" });
  }
});

router.get("/period-summary-pdf", async (req, res) => {
  try {
    const { start, end, allTime } = req.query;
    const allTimeFlag = String(allTime) === "true";
    const startDate = start ? new Date(String(start)) : null;
    const endDate = end ? new Date(String(end)) : null;
    if (!allTimeFlag) {
      if (start && (!startDate || Number.isNaN(startDate.getTime()))) {
        return res.status(400).json({ error: "Invalid start date" });
      }
      if (end && (!endDate || Number.isNaN(endDate.getTime()))) {
        return res.status(400).json({ error: "Invalid end date" });
      }
    }

    const dateFilter = allTimeFlag
      ? undefined
      : {
          gte: startDate ? toStartOfDay(startDate) : undefined,
          lte: endDate ? toEndOfDay(endDate) : undefined,
        };

    const [receipts, purchases, payments] = await Promise.all([
      prisma.receipt.findMany({
        where: dateFilter ? { date: dateFilter as any } : undefined,
        include: {
          items: { include: { product: true } },
        },
      }),
      prisma.inventoryEntry.findMany({
        where: {
          type: InventoryEntryType.PURCHASE,
          ...(dateFilter ? { entryDate: dateFilter as any } : {}),
        },
        include: { product: true },
      }),
      prisma.payment.findMany({
        where: dateFilter ? { date: dateFilter as any } : undefined,
      }),
    ]);

    const soldTotal = receipts.reduce((sum, r) => sum + Number(r.total ?? 0), 0);
    const soldPaid = receipts.reduce((sum, r) => sum + Number(r.amountPaid ?? 0), 0);
    const soldOutstanding = Math.max(soldTotal - soldPaid, 0);

    const boughtTotal = purchases.reduce((sum, p) => sum + Number(p.totalCost ?? 0), 0);
    const boughtPaid = purchases.reduce((sum, p) => sum + Number(p.amountPaid ?? 0), 0);
    const boughtOutstanding = Math.max(boughtTotal - boughtPaid, 0);

    const inflows = payments
      .filter((p) => p.type === PaymentType.RECEIPT || p.type === PaymentType.CUSTOMER_PAYMENT)
      .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    const outflows = payments
      .filter((p) => p.type !== PaymentType.RECEIPT && p.type !== PaymentType.CUSTOMER_PAYMENT)
      .reduce((sum, p) => sum + Number(p.amount ?? 0), 0);
    const netCash = inflows - outflows;

    type ProductTotals = {
      name: string;
      soldQty: number;
      boughtQty: number;
    };
    const productMap = new Map<number, ProductTotals>();

    receipts.forEach((receipt) => {
      receipt.items.forEach((item) => {
        if (!item.productId) return;
        const entry =
          productMap.get(item.productId) ??
          {
            name: item.product?.name ?? `Product #${item.productId}`,
            soldQty: 0,
            boughtQty: 0,
          };
        entry.soldQty += Number(item.quantity ?? 0);
        productMap.set(item.productId, entry);
      });
    });

    purchases.forEach((purchase) => {
      if (!purchase.productId) return;
      const entry =
        productMap.get(purchase.productId) ??
        {
          name: purchase.product?.name ?? `Product #${purchase.productId}`,
          soldQty: 0,
          boughtQty: 0,
        };
      entry.boughtQty += Number(purchase.quantity ?? 0);
      productMap.set(purchase.productId, entry);
    });

    const doc = new PDFDocument({ margin: 36, size: "A4" });
    const filename = "period_summary.pdf";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    doc.pipe(res);

    const title = "Finance period summary";
    const rangeLabel = allTimeFlag
      ? "All time"
      : `${startDate ? startDate.toISOString().slice(0, 10) : "start"} → ${
          endDate ? endDate.toISOString().slice(0, 10) : "end"
        }`;

    const fmt = (value: number) => `$${value.toFixed(2)}`;
    doc.fontSize(16).text(title);
    doc.fontSize(10).fillColor("#666").text(rangeLabel);
    doc.moveDown();

    doc.fontSize(12).fillColor("#000").text("Headline totals");
    doc.moveDown(0.25);
    const headline = [
      ["Sold total", fmt(soldTotal)],
      ["Sold paid", fmt(soldPaid)],
      ["Sold outstanding", fmt(soldOutstanding)],
      ["Bought total", fmt(boughtTotal)],
      ["Bought paid", fmt(boughtPaid)],
      ["Bought outstanding", fmt(boughtOutstanding)],
      ["Cash in", fmt(inflows)],
      ["Cash out", fmt(outflows)],
      ["Net cash", fmt(netCash)],
    ];
    headline.forEach(([label, value]) => {
      doc.fontSize(10).fillColor("#333").text(`${label}: `, { continued: true }).fillColor("#000").text(value);
    });
    doc.moveDown();

    doc.fontSize(12).fillColor("#000").text("Product net movement");
    doc.moveDown(0.25);
    doc.fontSize(9);
    doc.text("Product                     Sold qty     Bought qty     Net", { continued: false });
    doc.moveDown(0.25);
    Array.from(productMap.values())
      .sort((a, b) => a.name.localeCompare(b.name))
      .forEach((entry) => {
        const net = entry.boughtQty - entry.soldQty;
        doc.text(
          `${entry.name.padEnd(26, " ").slice(0, 26)} ${entry.soldQty.toFixed(3).padStart(10, " ")} ${entry.boughtQty
            .toFixed(3)
            .padStart(13, " ")} ${net.toFixed(3).padStart(10, " ")}`,
        );
      });

    doc.end();
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to generate period summary PDF" });
  }
});

export default router;
