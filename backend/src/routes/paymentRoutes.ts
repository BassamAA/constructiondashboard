import { Router } from "express";
import { DebrisStatus, PaymentType, Prisma } from "@prisma/client";
import prisma from "../prismaClient";
import { logAudit } from "../utils/auditLogger";
import { computeInventoryAmount } from "../utils/cashFlows";

const router = Router();

const CUSTOMER_PAYMENT = "CUSTOMER_PAYMENT" as const;
const SUPPORTED_PAYMENT_TYPES = [...Object.values(PaymentType), CUSTOMER_PAYMENT] as const;
type SupportedPaymentType = (typeof SUPPORTED_PAYMENT_TYPES)[number];

const paymentInclude = {
  supplier: true,
  customer: true,
  receipt: true,
  payrollEntry: {
    include: {
      employee: true,
    },
  },
  receiptPayments: {
    include: {
      receipt: true,
    },
  },
  inventoryPayments: {
    include: {
      inventoryEntry: true,
    },
  },
  debrisRemoval: true,
  truckRepair: {
    include: {
      truck: true,
    },
  },
};

const paymentFullInclude = paymentInclude;

type PaymentWithRelations = Prisma.PaymentGetPayload<{
  include: typeof paymentFullInclude;
}>;

type ReceiptAllocation = {
  receiptId: number;
  amount: number;
  currentPaid: number;
  total: number;
};

type SanitizedPaymentInput = {
  amount: number;
  sanitizedType: SupportedPaymentType;
  hasDateOverride: boolean;
  dateValue: Date | null;
  description: string | null;
  category: string | null;
  reference: string | null;
  supplierId: number | null;
  customerId: number | null;
  receiptId: number | null;
  payrollEntryId: number | null;
  debrisEntryId: number | null;
  receiptAllocations: ReceiptAllocation[];
  applyCustomerPayments: boolean;
  applySupplierPayments: boolean;
};

function normalizePaymentType(type: SupportedPaymentType): PaymentType {
  return type === CUSTOMER_PAYMENT
    ? PaymentType.CUSTOMER_PAYMENT
    : (type as PaymentType);
}

function parseOptionalId(value: unknown): number | null {
  if (value === undefined || value === null || `${value}`.trim().length === 0) {
    return null;
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    throw new Error("INVALID_ID");
  }
  return parsed;
}

async function sanitizePaymentInput(
  body: any,
  options?: { existingPayment?: PaymentWithRelations },
): Promise<SanitizedPaymentInput> {
  const paymentAmount = Number(body?.amount);
  if (body?.amount === undefined || Number.isNaN(paymentAmount) || paymentAmount <= 0) {
    throw new Error("INVALID_AMOUNT");
  }

  const normalizedType = String(body?.type ?? "").toUpperCase();
  if (!(SUPPORTED_PAYMENT_TYPES as readonly string[]).includes(normalizedType)) {
    throw new Error("INVALID_TYPE");
  }
  const sanitizedType = normalizedType as SupportedPaymentType;

  const hasDateOverride = typeof body?.date === "string" && body.date.trim().length > 0;
  let dateValue: Date | null = null;
  if (hasDateOverride) {
    dateValue = new Date(body.date);
    if (Number.isNaN(dateValue.getTime())) {
      throw new Error("INVALID_DATE");
    }
  }

  const description =
    typeof body?.description === "string" && body.description.trim().length > 0
      ? body.description.trim()
      : null;
  const category =
    typeof body?.category === "string" && body.category.trim().length > 0
      ? body.category.trim()
      : null;
  const reference =
    typeof body?.reference === "string" && body.reference.trim().length > 0
      ? body.reference.trim()
      : null;

  let parsedSupplierId: number | null = null;
  let parsedCustomerId: number | null = null;
  let parsedReceiptId: number | null = null;
  let parsedPayrollEntryId: number | null = null;
  let parsedDebrisEntryId: number | null = null;

  try {
    parsedSupplierId = parseOptionalId(body?.supplierId);
  } catch {
    throw new Error("INVALID_SUPPLIER");
  }
  try {
    parsedCustomerId = parseOptionalId(body?.customerId);
  } catch {
    throw new Error("INVALID_CUSTOMER");
  }
  try {
    parsedReceiptId = parseOptionalId(body?.receiptId);
  } catch {
    throw new Error("INVALID_RECEIPT");
  }
  try {
    parsedPayrollEntryId = parseOptionalId(body?.payrollEntryId);
  } catch {
    throw new Error("INVALID_PAYROLL");
  }
  try {
    parsedDebrisEntryId = parseOptionalId(body?.debrisEntryId);
  } catch {
    throw new Error("INVALID_DEBRIS");
  }

  if (sanitizedType === PaymentType.SUPPLIER && parsedSupplierId === null) {
    throw new Error("SUPPLIER_REQUIRED");
  }
  if (sanitizedType === PaymentType.RECEIPT && parsedReceiptId === null) {
    throw new Error("RECEIPT_REQUIRED");
  }
  if (sanitizedType === PaymentType.RECEIPT && parsedReceiptId !== null && parsedCustomerId === null) {
    // receipt will be fetched below to infer customer
  }
  if (
    (sanitizedType === PaymentType.PAYROLL_SALARY ||
      sanitizedType === PaymentType.PAYROLL_PIECEWORK) &&
    parsedPayrollEntryId === null
  ) {
    throw new Error("PAYROLL_REQUIRED");
  }
  if (sanitizedType === PaymentType.DEBRIS_REMOVAL && parsedDebrisEntryId === null) {
    throw new Error("DEBRIS_REQUIRED");
  }
  if (sanitizedType === CUSTOMER_PAYMENT && parsedCustomerId === null) {
    throw new Error("CUSTOMER_REQUIRED");
  }

  if (parsedSupplierId !== null) {
    const supplierExists = await prisma.supplier.findUnique({ where: { id: parsedSupplierId } });
    if (!supplierExists) {
      throw new Error("SUPPLIER_NOT_FOUND");
    }
  }

  let receiptCustomerId: number | null = null;
  if (parsedReceiptId !== null) {
    const receiptExists = await prisma.receipt.findUnique({ where: { id: parsedReceiptId } });
    if (!receiptExists) {
      throw new Error("RECEIPT_NOT_FOUND");
    }
    if (!receiptExists.customerId) {
      throw new Error("CUSTOMER_REQUIRED");
    }
    receiptCustomerId = receiptExists.customerId;
    if (sanitizedType === PaymentType.RECEIPT && parsedCustomerId === null) {
      parsedCustomerId = receiptCustomerId;
    }
  }

  if (parsedPayrollEntryId !== null) {
    const payrollEntry = await prisma.payrollEntry.findUnique({
      where: { id: parsedPayrollEntryId },
      include: { payment: true },
    });
    if (!payrollEntry) {
      throw new Error("PAYROLL_NOT_FOUND");
    }
    if (
      payrollEntry.paymentId &&
      payrollEntry.paymentId !== options?.existingPayment?.payrollEntry?.paymentId
    ) {
      throw new Error("PAYROLL_ALREADY_PAID");
    }
  }

  if (parsedDebrisEntryId !== null) {
    const debrisEntry = await prisma.debrisEntry.findUnique({ where: { id: parsedDebrisEntryId } });
    if (!debrisEntry) {
      throw new Error("DEBRIS_NOT_FOUND");
    }
    if (
      debrisEntry.removalPaymentId &&
      debrisEntry.removalPaymentId !== options?.existingPayment?.debrisRemoval?.removalPaymentId
    ) {
      throw new Error("DEBRIS_ALREADY_PAID");
    }
  }

  const applyCustomerPayments =
    sanitizedType === CUSTOMER_PAYMENT ? body?.applyToReceipts !== false : true;
  const applySupplierPayments = sanitizedType === PaymentType.SUPPLIER ? body?.applyToPurchases !== false : false;
  if (sanitizedType === CUSTOMER_PAYMENT && applyCustomerPayments && parsedCustomerId === null) {
    throw new Error("CUSTOMER_REQUIRED");
  }
  const receiptAllocations: ReceiptAllocation[] = [];
  if (sanitizedType === CUSTOMER_PAYMENT && parsedCustomerId !== null && applyCustomerPayments) {
    const openReceipts = await prisma.receipt.findMany({
      where: { customerId: parsedCustomerId },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
    let remaining = paymentAmount;
    for (const receipt of openReceipts) {
      if (remaining <= 0) break;
      const outstanding = Number(receipt.total) - Number(receipt.amountPaid);
      if (outstanding <= 0) continue;
      const applied = Math.min(outstanding, remaining);
      receiptAllocations.push({
        receiptId: receipt.id,
        amount: applied,
        currentPaid: Number(receipt.amountPaid ?? 0),
        total: Number(receipt.total),
      });
      remaining -= applied;
      if (remaining <= 0) break;
    }
  }

  return {
    amount: paymentAmount,
    sanitizedType,
    hasDateOverride,
    dateValue: hasDateOverride ? dateValue : null,
    description,
    category,
    reference,
    supplierId: sanitizedType === PaymentType.SUPPLIER ? parsedSupplierId : null,
    customerId: sanitizedType === CUSTOMER_PAYMENT ? parsedCustomerId : null,
    receiptId: sanitizedType === PaymentType.RECEIPT ? parsedReceiptId : null,
    payrollEntryId:
      sanitizedType === PaymentType.PAYROLL_SALARY ||
      sanitizedType === PaymentType.PAYROLL_PIECEWORK
        ? parsedPayrollEntryId
        : null,
    debrisEntryId: sanitizedType === PaymentType.DEBRIS_REMOVAL ? parsedDebrisEntryId : null,
    receiptAllocations,
    applyCustomerPayments,
    applySupplierPayments,
  };
}

async function applyPaymentEffects(
  tx: Prisma.TransactionClient,
  payment: PaymentWithRelations,
  input: SanitizedPaymentInput,
) {
  const paymentId = payment.id;
  const touchedReceiptIds = new Set<number>();
  const touchedInventoryIds = new Set<number>();

  if (input.receiptId) {
    const receipt = await tx.receipt.findUnique({ where: { id: input.receiptId } });
    if (receipt) {
      const outstanding = Math.max(0, Number(receipt.total) - Number(receipt.amountPaid));
      const applied = Math.min(input.amount, outstanding);
      if (applied > 0) {
        await tx.receiptPayment.create({
          data: {
            paymentId,
            receiptId: receipt.id,
            amount: applied,
          },
        });
        const newAmountPaid = Number(receipt.amountPaid ?? 0) + applied;
        await tx.receipt.update({
          where: { id: receipt.id },
          data: {
            amountPaid: newAmountPaid,
            isPaid: newAmountPaid >= Number(receipt.total) - 1e-6,
          },
        });
        touchedReceiptIds.add(receipt.id);
      }
    }
  }

  if (input.applyCustomerPayments && input.receiptAllocations.length > 0) {
    for (const alloc of input.receiptAllocations) {
      if (alloc.amount <= 0) continue;
      await tx.receiptPayment.create({
        data: {
          paymentId,
          receiptId: alloc.receiptId,
          amount: alloc.amount,
        },
      });
      const newAmountPaid = alloc.currentPaid + alloc.amount;
      await tx.receipt.update({
        where: { id: alloc.receiptId },
        data: {
          amountPaid: newAmountPaid,
          isPaid: newAmountPaid >= alloc.total - 1e-6,
        },
      });
      touchedReceiptIds.add(alloc.receiptId);
    }
  }

  if (input.payrollEntryId) {
    await tx.payrollEntry.update({
      where: { id: input.payrollEntryId },
      data: { paymentId },
    });
  }

  if (input.debrisEntryId && input.sanitizedType === PaymentType.DEBRIS_REMOVAL) {
    await tx.debrisEntry.update({
      where: { id: input.debrisEntryId },
      data: {
        status: DebrisStatus.REMOVED,
        removalCost: input.amount,
        removalDate: payment.date,
        removalPaymentId: paymentId,
      },
    });
  }

  // Auto-apply supplier payments to oldest unpaid purchases (with partial links)
  if (input.sanitizedType === PaymentType.SUPPLIER && input.applySupplierPayments && input.supplierId) {
    let remaining = input.amount;
    const unpaidPurchases = await tx.inventoryEntry.findMany({
      where: { supplierId: input.supplierId, type: "PURCHASE", isPaid: false },
      orderBy: [{ entryDate: "asc" }, { id: "asc" }],
      select: { id: true, totalCost: true, unitCost: true, quantity: true, amountPaid: true },
    });
    for (const entry of unpaidPurchases) {
      if (remaining <= 0) break;
      const totalCost = computeInventoryAmount(entry);
      const alreadyPaid = Number(entry.amountPaid ?? 0);
      const outstanding = Math.max(totalCost - alreadyPaid, 0);
      if (outstanding <= 0) continue;
      const applied = Math.min(outstanding, remaining);
      if (applied <= 0) continue;
      await tx.inventoryPayment.create({
        data: {
          paymentId,
          inventoryEntryId: entry.id,
          amount: applied,
        },
      });
      const newPaid = alreadyPaid + applied;
      await tx.inventoryEntry.update({
        where: { id: entry.id },
        data: { amountPaid: newPaid, isPaid: newPaid >= totalCost - 1e-6 },
      });
      touchedInventoryIds.add(entry.id);
      remaining -= applied;
    }
  }

  // Recompute touched receipts' paid status from links to avoid drift
  if (touchedReceiptIds.size > 0) {
    await recomputeReceiptsPaid(tx, Array.from(touchedReceiptIds));
  }
  if (touchedInventoryIds.size > 0) {
    await recomputeInventoryPaid(tx, Array.from(touchedInventoryIds));
  }
}

async function revertPaymentEffects(tx: Prisma.TransactionClient, payment: PaymentWithRelations) {
  const touchedReceiptIds = new Set<number>();
  const touchedInventoryIds = new Set<number>();
  if (payment.receiptPayments?.length) {
    for (const link of payment.receiptPayments) {
      const receipt = await tx.receipt.findUnique({ where: { id: link.receiptId } });
      if (!receipt) continue;
      const newAmountPaid = Math.max(0, Number(receipt.amountPaid ?? 0) - Number(link.amount));
      await tx.receipt.update({
        where: { id: receipt.id },
        data: {
          amountPaid: newAmountPaid,
          isPaid: newAmountPaid >= Number(receipt.total) - 1e-6,
        },
      });
      touchedReceiptIds.add(receipt.id);
    }
    await tx.receiptPayment.deleteMany({ where: { paymentId: payment.id } });
  }

  if (payment.inventoryPayments?.length) {
    for (const link of payment.inventoryPayments) {
      const entry = await tx.inventoryEntry.findUnique({ where: { id: link.inventoryEntryId } });
      if (!entry) continue;
      const newPaid = Math.max(0, Number(entry.amountPaid ?? 0) - Number(link.amount));
      const totalCost = computeInventoryAmount(entry);
      await tx.inventoryEntry.update({
        where: { id: entry.id },
        data: { amountPaid: newPaid, isPaid: newPaid >= totalCost - 1e-6 },
      });
      touchedInventoryIds.add(entry.id);
    }
    await tx.inventoryPayment.deleteMany({ where: { paymentId: payment.id } });
  }

  if (payment.payrollEntry) {
    await tx.payrollEntry.update({
      where: { id: payment.payrollEntry.id },
      data: { paymentId: null },
    });
  }

  if (payment.debrisRemoval) {
    await tx.debrisEntry.update({
      where: { id: payment.debrisRemoval.id },
      data: {
        status: DebrisStatus.PENDING,
        removalCost: null,
        removalDate: null,
        removalPaymentId: null,
      },
    });
  }

  if (touchedReceiptIds.size > 0) {
    await recomputeReceiptsPaid(tx, Array.from(touchedReceiptIds));
  }
  if (touchedInventoryIds.size > 0) {
    await recomputeInventoryPaid(tx, Array.from(touchedInventoryIds));
  }
}

async function recomputeReceiptsPaid(tx: Prisma.TransactionClient, receiptIds: number[]) {
  if (!receiptIds.length) return;
  const [linkSums, directSums, receipts] = await Promise.all([
    tx.receiptPayment.groupBy({
      by: ["receiptId"],
      _sum: { amount: true },
      where: { receiptId: { in: receiptIds } },
    }),
    tx.payment.groupBy({
      by: ["receiptId"],
      _sum: { amount: true },
      where: { receiptId: { in: receiptIds }, type: PaymentType.RECEIPT },
    }),
    tx.receipt.findMany({ where: { id: { in: receiptIds } }, select: { id: true, total: true } }),
  ]);

  const paidMap = new Map<number, number>();
  linkSums.forEach((r) => paidMap.set(r.receiptId, Number(r._sum.amount ?? 0)));
  directSums.forEach((r) => {
    if (r.receiptId === null) return;
    paidMap.set(r.receiptId, (paidMap.get(r.receiptId) ?? 0) + Number(r._sum.amount ?? 0));
  });

  for (const r of receipts) {
    const paid = paidMap.get(r.id) ?? 0;
    await tx.receipt.update({
      where: { id: r.id },
      data: { amountPaid: paid, isPaid: paid >= Number(r.total) - 1e-6 },
    });
  }
}

async function recomputeInventoryPaid(tx: Prisma.TransactionClient, inventoryEntryIds: number[]) {
  if (!inventoryEntryIds.length) return;
  const [linkSums, entries] = await Promise.all([
    tx.inventoryPayment.groupBy({
      by: ["inventoryEntryId"],
      _sum: { amount: true },
      where: { inventoryEntryId: { in: inventoryEntryIds } },
    }),
    tx.inventoryEntry.findMany({
      where: { id: { in: inventoryEntryIds } },
      select: { id: true, totalCost: true, unitCost: true, quantity: true },
    }),
  ]);

  const paidMap = new Map<number, number>();
  linkSums.forEach((r) => paidMap.set(r.inventoryEntryId, Number(r._sum.amount ?? 0)));

  for (const entry of entries) {
    const paid = paidMap.get(entry.id) ?? 0;
    const total = computeInventoryAmount(entry);
    await tx.inventoryEntry.update({
      where: { id: entry.id },
      data: { amountPaid: paid, isPaid: paid >= total - 1e-6 },
    });
  }
}

router.get("/", async (req, res) => {
  try {
    const { type, supplierId, customerId, receiptId, employeeId, description } = req.query;
    const where: Prisma.PaymentWhereInput = {};

    if (type) {
      const normalizedType = String(type).toUpperCase();
      if (!Object.values(PaymentType).includes(normalizedType as PaymentType)) {
        return res.status(400).json({ error: "Invalid payment type filter" });
      }
      where.type = normalizedType as PaymentType;
    }

    if (supplierId) {
      const parsed = Number(supplierId);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ error: "Invalid supplierId" });
      }
      where.supplierId = parsed;
    }

    if (customerId) {
      const parsed = Number(customerId);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ error: "Invalid customerId" });
      }
      where.customerId = parsed;
    }

    if (receiptId) {
      const parsed = Number(receiptId);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ error: "Invalid receiptId" });
      }
      where.receiptId = parsed;
    }

    if (employeeId) {
      const parsed = Number(employeeId);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ error: "Invalid employeeId" });
      }
      where.payrollEntry = { employeeId: parsed };
    }

    if (description) {
      const trimmed = String(description).trim();
      if (trimmed.length > 0) {
        where.OR = [
          { description: { contains: trimmed, mode: "insensitive" } },
          { customer: { name: { contains: trimmed, mode: "insensitive" } } },
          { supplier: { name: { contains: trimmed, mode: "insensitive" } } },
        ];
      }
    }

    const payments = await prisma.payment.findMany({
      where,
      include: paymentInclude,
      orderBy: { date: "desc" },
    });

    res.json(payments);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch payments" });
  }
});

router.post("/", async (req, res) => {
  try {
    const sanitized = await sanitizePaymentInput(req.body);

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          date: sanitized.hasDateOverride ? sanitized.dateValue ?? undefined : undefined,
          amount: sanitized.amount,
          type: normalizePaymentType(sanitized.sanitizedType),
          description: sanitized.description,
          category: sanitized.category,
          reference: sanitized.reference,
          supplierId: sanitized.supplierId,
          customerId: sanitized.customerId,
          receiptId: sanitized.receiptId,
        },
        include: paymentInclude,
      });

      await applyPaymentEffects(tx, created, sanitized);

      return created;
    });

    const fresh = await prisma.payment.findUnique({
      where: { id: payment.id },
      include: paymentInclude,
    });

    if (fresh) {
      await logAudit({
        action: "PAYMENT_CREATED",
        entityType: "payment",
        entityId: fresh.id,
        description: `Payment ${fresh.id} of ${fresh.amount.toFixed(2)} recorded (${fresh.type})`,
        metadata: {
          type: fresh.type,
          amount: fresh.amount,
          supplierId: fresh.supplierId,
          customerId: fresh.customerId,
        },
      });
    }

    res.status(201).json(fresh);
  } catch (err: any) {
    if (err instanceof Error) {
      switch (err.message) {
        case "INVALID_AMOUNT":
          return res.status(400).json({ error: "amount must be a positive number" });
        case "INVALID_TYPE":
          return res.status(400).json({ error: "Invalid payment type" });
        case "INVALID_DATE":
          return res.status(400).json({ error: "Invalid payment date" });
        case "INVALID_SUPPLIER":
          return res.status(400).json({ error: "Invalid supplierId" });
        case "INVALID_CUSTOMER":
          return res.status(400).json({ error: "Invalid customerId" });
        case "INVALID_RECEIPT":
          return res.status(400).json({ error: "Invalid receiptId" });
        case "INVALID_PAYROLL":
          return res.status(400).json({ error: "Invalid payrollEntryId" });
        case "INVALID_DEBRIS":
          return res.status(400).json({ error: "Invalid debrisEntryId" });
        case "SUPPLIER_REQUIRED":
          return res.status(400).json({ error: "supplierId is required for supplier payments" });
        case "RECEIPT_REQUIRED":
          return res.status(400).json({ error: "receiptId is required for receipt payments" });
        case "PAYROLL_REQUIRED":
          return res.status(400).json({ error: "payrollEntryId is required for payroll payments" });
        case "DEBRIS_REQUIRED":
          return res.status(400).json({ error: "debrisEntryId is required for debris removal payments" });
        case "CUSTOMER_REQUIRED":
          return res.status(400).json({ error: "customerId is required for customer payments" });
        case "SUPPLIER_NOT_FOUND":
          return res.status(404).json({ error: "Supplier not found" });
        case "RECEIPT_NOT_FOUND":
          return res.status(404).json({ error: "Receipt not found" });
        case "PAYROLL_NOT_FOUND":
          return res.status(404).json({ error: "Payroll entry not found" });
        case "PAYROLL_ALREADY_PAID":
          return res.status(400).json({ error: "Payroll entry already linked to a payment" });
        case "DEBRIS_NOT_FOUND":
          return res.status(404).json({ error: "Debris entry not found" });
        case "DEBRIS_ALREADY_PAID":
          return res.status(400).json({ error: "Debris entry already marked as removed" });
        default:
          break;
      }
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to create payment" });
  }
});

router.put("/:id", async (req, res) => {
  const paymentId = Number(req.params.id);
  if (Number.isNaN(paymentId)) {
    return res.status(400).json({ error: "Invalid payment id" });
  }

  try {
    const existing = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: paymentFullInclude,
    });
    if (!existing) {
      return res.status(404).json({ error: "Payment not found" });
    }

    const sanitized = await sanitizePaymentInput(req.body, { existingPayment: existing });

    await prisma.$transaction(async (tx) => {
      const paymentForUpdate = await tx.payment.findUnique({
        where: { id: paymentId },
        include: paymentFullInclude,
      });
      if (!paymentForUpdate) {
        throw new Error("PAYMENT_NOT_FOUND");
      }

      await revertPaymentEffects(tx, paymentForUpdate);

      const updated = await tx.payment.update({
        where: { id: paymentId },
        data: {
          date: sanitized.hasDateOverride ? sanitized.dateValue ?? undefined : undefined,
          amount: sanitized.amount,
          type: normalizePaymentType(sanitized.sanitizedType),
          description: sanitized.description,
          category: sanitized.category,
          reference: sanitized.reference,
          supplierId: sanitized.supplierId,
          customerId: sanitized.customerId,
          receiptId: sanitized.receiptId,
        },
        include: paymentFullInclude,
      });

      await applyPaymentEffects(tx, updated, sanitized);
    });

    const fresh = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: paymentInclude,
    });

    if (fresh) {
      await logAudit({
        action: "PAYMENT_UPDATED",
        entityType: "payment",
        entityId: fresh.id,
        description: `Payment ${fresh.id} updated (${fresh.type})`,
        metadata: {
          type: fresh.type,
          amount: fresh.amount,
          supplierId: fresh.supplierId,
          customerId: fresh.customerId,
        },
      });
    }

    res.json(fresh);
  } catch (err: any) {
    if (err instanceof Error) {
      if (err.message === "PAYMENT_NOT_FOUND") {
        return res.status(404).json({ error: "Payment not found" });
      }
      switch (err.message) {
        case "INVALID_AMOUNT":
          return res.status(400).json({ error: "amount must be a positive number" });
        case "INVALID_TYPE":
          return res.status(400).json({ error: "Invalid payment type" });
        case "INVALID_DATE":
          return res.status(400).json({ error: "Invalid payment date" });
        case "INVALID_SUPPLIER":
          return res.status(400).json({ error: "Invalid supplierId" });
        case "INVALID_CUSTOMER":
          return res.status(400).json({ error: "Invalid customerId" });
        case "INVALID_RECEIPT":
          return res.status(400).json({ error: "Invalid receiptId" });
        case "INVALID_PAYROLL":
          return res.status(400).json({ error: "Invalid payrollEntryId" });
        case "INVALID_DEBRIS":
          return res.status(400).json({ error: "Invalid debrisEntryId" });
        case "SUPPLIER_REQUIRED":
          return res.status(400).json({ error: "supplierId is required for supplier payments" });
        case "RECEIPT_REQUIRED":
          return res.status(400).json({ error: "receiptId is required for receipt payments" });
        case "PAYROLL_REQUIRED":
          return res.status(400).json({ error: "payrollEntryId is required for payroll payments" });
        case "DEBRIS_REQUIRED":
          return res.status(400).json({ error: "debrisEntryId is required for debris removal payments" });
        case "CUSTOMER_REQUIRED":
          return res.status(400).json({ error: "customerId is required for customer payments" });
        case "SUPPLIER_NOT_FOUND":
          return res.status(404).json({ error: "Supplier not found" });
        case "RECEIPT_NOT_FOUND":
          return res.status(404).json({ error: "Receipt not found" });
        case "PAYROLL_NOT_FOUND":
          return res.status(404).json({ error: "Payroll entry not found" });
        case "PAYROLL_ALREADY_PAID":
          return res.status(400).json({ error: "Payroll entry already linked to a payment" });
        case "DEBRIS_NOT_FOUND":
          return res.status(404).json({ error: "Debris entry not found" });
        case "DEBRIS_ALREADY_PAID":
          return res.status(400).json({ error: "Debris entry already marked as removed" });
        default:
          break;
      }
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update payment" });
  }
});

router.delete("/:id", async (req, res) => {
  const paymentId = Number(req.params.id);
  if (Number.isNaN(paymentId)) {
    return res.status(400).json({ error: "Invalid payment id" });
  }

  try {
    const existing = await prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!existing) {
      return res.status(404).json({ error: "Payment not found" });
    }

    await prisma.$transaction(async (tx) => {
      const paymentToDelete = await tx.payment.findUnique({
        where: { id: paymentId },
        include: paymentFullInclude,
      });
      if (!paymentToDelete) {
        throw new Error("PAYMENT_NOT_FOUND");
      }

      await revertPaymentEffects(tx, paymentToDelete);
      await tx.payment.delete({ where: { id: paymentId } });
    });

    await logAudit({
      action: "PAYMENT_DELETED",
      entityType: "payment",
      entityId: paymentId,
      description: `Payment ${paymentId} deleted`,
    });

    res.status(204).end();
  } catch (err: any) {
    if (err instanceof Error && err.message === "PAYMENT_NOT_FOUND") {
      return res.status(404).json({ error: "Payment not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to delete payment" });
  }
});

export default router;
