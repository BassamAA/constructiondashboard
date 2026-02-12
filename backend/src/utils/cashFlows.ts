import { PaymentType, PrismaClient, Prisma } from "@prisma/client";

export const cashInTypes: PaymentType[] = [PaymentType.RECEIPT, PaymentType.CUSTOMER_PAYMENT];
export const cashOutTypes: PaymentType[] = [
  PaymentType.GENERAL_EXPENSE,
  PaymentType.SUPPLIER,
  PaymentType.PAYROLL_SALARY,
  PaymentType.PAYROLL_PIECEWORK,
  PaymentType.DEBRIS_REMOVAL,
  PaymentType.OWNER_DRAW,
];

// Kept for callers that still import this utility
export const computeInventoryAmount = (entry: {
  totalCost: number | null;
  unitCost: number | null;
  quantity: number;
}) => {
  if (entry.totalCost !== null && entry.totalCost !== undefined) {
    return Number(entry.totalCost);
  }
  if (entry.unitCost !== null && entry.unitCost !== undefined) {
    return Number(entry.unitCost) * Number(entry.quantity);
  }
  return 0;
};

type CashFlowRange = { start?: Date; end?: Date };
type CashFlowFilters = {
  customerId?: number;
  supplierId?: number;
  productId?: number;
};

export async function fetchCashFlows(
  prisma: PrismaClient,
  range?: CashFlowRange,
  filters?: CashFlowFilters,
) {
  const dateFilter =
    range && (range.start || range.end)
      ? {
          gte: range.start ?? undefined,
          lte: range.end ?? undefined,
        }
      : undefined;

  const customerFilter = filters?.customerId ? Number(filters.customerId) : null;
  const supplierFilter = filters?.supplierId ? Number(filters.supplierId) : null;
  const productFilter = filters?.productId ? Number(filters.productId) : null;

  // Full ledger: use all payments, no pagination. Avoid double-counting receipts.
  const [inflowPayments, outflowPayments] = await Promise.all([
    prisma.payment.findMany({
      where: {
        type: { in: cashInTypes },
        date: dateFilter,
        ...(customerFilter || productFilter
          ? {
              OR: [
                ...(customerFilter
                  ? [
                      { customerId: customerFilter },
                      { receipt: { is: { customerId: customerFilter } } },
                    ]
                  : []),
                ...(productFilter
                  ? [
                      {
                        receipt: {
                          is: {
                            items: {
                              some: { productId: productFilter },
                            },
                          },
                        },
                      },
                    ]
                  : []),
              ] as Prisma.PaymentWhereInput[], // satisfy union type
            }
          : {}),
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: {
        customer: true,
        receipt: {
          include: {
            items: {
              select: {
                productId: true,
              },
            },
          },
        },
      },
    }),
    prisma.payment.findMany({
      where: {
        type: { in: cashOutTypes },
        date: dateFilter,
        ...(supplierFilter ? { supplierId: supplierFilter } : {}),
      },
      orderBy: [{ date: "desc" }, { id: "desc" }],
      include: {
        supplier: true,
        payrollEntry: {
          include: {
            employee: true,
          },
        },
      },
    }),
  ]);

  // Receipts paid directly (no payment rows and no ReceiptPayment links)
  const receiptIdsWithPayment = new Set(
    inflowPayments.filter((p) => p.receiptId).map((p) => p.receiptId!),
  );
  const directReceipts = await prisma.receipt.findMany({
    where: {
      amountPaid: { gt: 0 },
      isPaid: true,
      receiptPayments: { none: {} },
      id: { notIn: Array.from(receiptIdsWithPayment) },
      date: dateFilter,
      ...(customerFilter ? { customerId: customerFilter } : {}),
      ...(productFilter
        ? {
            items: {
              some: { productId: productFilter },
            },
          }
        : {}),
    },
    select: {
      id: true,
      receiptNo: true,
      amountPaid: true,
      date: true,
      customer: { select: { name: true } },
      walkInName: true,
    },
  });

  const inflows = inflowPayments
    .map((payment) => ({
      id: `payment-${payment.id}`,
      type: payment.type,
      label:
        payment.description || (payment as any).customer?.name || payment.reference || `Payment #${payment.id}`,
      amount: Number(payment.amount),
      date: payment.date,
      context: (payment as any).receipt
        ? {
            receiptNo: (payment as any).receipt.receiptNo,
          }
        : undefined,
    }))
    .concat(
      directReceipts.map((receipt) => ({
        id: `direct-receipt-${receipt.id}`,
        type: PaymentType.RECEIPT,
        label: receipt.receiptNo ?? `Receipt #${receipt.id}`,
        amount: Number(receipt.amountPaid ?? 0),
        date: receipt.date,
        context: {
          receiptNo: receipt.receiptNo ?? `Receipt #${receipt.id}`,
        },
      })),
    );

  let filteredInflows = inflows;
  let filteredOutflows = outflowPayments.map((payment) => ({
    id: `payment-${payment.id}`,
    type: payment.type,
    label: payment.description || payment.supplier?.name || payment.reference || `Payment #${payment.id}`,
    amount: Number(payment.amount),
    date: payment.date,
    context: payment.payrollEntry
      ? {
          employee: payment.payrollEntry.employee?.name,
        }
      : undefined,
  }));

  // When filtering by a specific customer, hide unrelated outflows.
  if (customerFilter && !supplierFilter && !productFilter) {
    filteredOutflows = [];
  }
  // When filtering by a specific supplier, hide unrelated inflows.
  if (supplierFilter && !customerFilter && !productFilter) {
    filteredInflows = [];
  }
  // When filtering by a specific product, only show inflows tied to receipts that include that product.
  if (productFilter) {
    const receiptHasProduct = new Set<number>();
    inflowPayments.forEach((p) => {
      const receipt = (p as any).receipt;
      if (receipt?.id && receipt.items) {
        const hasProduct = (receipt.items as any[]).some(
          (ri) => (ri as any).productId === productFilter,
        );
        if (hasProduct) {
          receiptHasProduct.add(receipt.id);
        }
      }
    });
    filteredInflows = filteredInflows.filter((entry) => {
      if (entry.type !== PaymentType.RECEIPT && entry.type !== PaymentType.CUSTOMER_PAYMENT) {
        return false;
      }
      if (entry.type === PaymentType.CUSTOMER_PAYMENT) {
        // keep customer payments only if customerFilter matches
        return Boolean(customerFilter);
      }
      if (typeof entry.id === "string" && entry.id.startsWith("payment-")) {
        const match = inflowPayments.find((p) => `payment-${p.id}` === entry.id) as any;
        const receiptId = match?.receipt?.id;
        return receiptId ? receiptHasProduct.has(receiptId) : false;
      }
      if (typeof entry.id === "string" && entry.id.startsWith("direct-receipt-")) {
        const parsed = Number(entry.id.replace("direct-receipt-", ""));
        return receiptHasProduct.has(parsed);
      }
      return false;
    });
    filteredOutflows = [];
  }

  const inflowTotal = filteredInflows.reduce((sum, entry) => sum + entry.amount, 0);
  const outflowTotal = filteredOutflows.reduce((sum, entry) => sum + entry.amount, 0);
  const cashOnHand = inflowTotal - outflowTotal;

  return { inflows: filteredInflows, outflows: filteredOutflows, inflowTotal, outflowTotal, cashOnHand };
}
