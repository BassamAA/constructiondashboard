import { Router } from "express";
import { Prisma, ReceiptType, StockMovementType, UserRole } from "@prisma/client";
import prisma from "../prismaClient";
import { logAudit } from "../utils/auditLogger";
import { receiptInclude } from "../utils/receiptInclude";
import { calculateCustomerOldBalance } from "../utils/outstandingBalance";

const router = Router();

const TVA_RATE = 0.11;
const TAX_MULTIPLIER = 1 + TVA_RATE;
const applyReceiptTax = (type: ReceiptType, baseTotal: number): number => {
  if (type !== ReceiptType.TVA) {
    return baseTotal;
  }
  const taxed = baseTotal * TAX_MULTIPLIER;
  return Math.round(taxed * 100) / 100;
};

type ReceiptItemInput = {
  productId: number;
  quantity: number;
  unitPrice: number | null;
  subtotal: number | null;
  displayQuantity?: number | null;
  displayUnit?: string | null;
};

type PriceOverridePayload = {
  receiptId: number;
  items: {
    itemId: number;
    unitPrice: number;
  }[];
};

const isDebrisProduct = (name: string | null | undefined) =>
  typeof name === "string" && name.trim().toLowerCase() === "debris";

const receiptNumberPattern = /^(\D*?)(\d+)(.*)$/;

const incrementReceiptNumber = (value: string | null | undefined, fallbackValue: string): string => {
  const defaultNumber = fallbackValue;
  if (!value) {
    return defaultNumber;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return defaultNumber;
  }

  const numeric = Number(trimmed);
  if (!Number.isNaN(numeric)) {
    if (/^0\d+$/.test(trimmed)) {
      return String(numeric + 1).padStart(trimmed.length, "0");
    }
    return String(numeric + 1);
  }

  const match = trimmed.match(receiptNumberPattern);
  if (!match) {
    return defaultNumber;
  }

  const [, prefix, digits, suffix] = match;
      const incremented = String(Number(digits) + 1).padStart(digits.length, "0");
      return `${prefix}${incremented}${suffix ?? ""}`;
};

const enforceTPrefix = (value: string): string =>
  value.toUpperCase().startsWith("T") ? value : `T${value}`;

class ReceiptNumberValidationError extends Error {
  status: number;
  expectedNext?: string;

  constructor(message: string, status = 400, expectedNext?: string) {
    super(message);
    this.name = "ReceiptNumberValidationError";
    this.status = status;
    this.expectedNext = expectedNext;
  }
}

const requireNextReceiptNumber = async (
  tx: Prisma.TransactionClient,
  type: ReceiptType,
  provided: string | null,
): Promise<string> => {
  const expectedNext = await generateNextReceiptNumber(tx, type);

  if (provided) {
    if (type === ReceiptType.TVA && !provided.toUpperCase().startsWith("T")) {
      throw new ReceiptNumberValidationError(
        `TVA receipts must start with "T". Next expected number is ${expectedNext}.`,
        400,
        expectedNext,
      );
    }
    if (provided !== expectedNext) {
      throw new ReceiptNumberValidationError(
        `Receipt number out of sequence. Next ${type} receipt should be ${expectedNext}.`,
        409,
        expectedNext,
      );
    }
    return provided;
  }

  return expectedNext;
};

const parseOptionalNumber = (value: unknown): { value: number | null; isValid: boolean } => {
  if (value === null || value === undefined) {
    return { value: null, isValid: true };
  }
  if (typeof value === "string" && value.trim().length === 0) {
    return { value: null, isValid: true };
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return { value: null, isValid: false };
  }
  return { value: parsed, isValid: true };
};

const parseBooleanFlag = (value: unknown): boolean => {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }
  return false;
};

const defaultSeedForType = (type: ReceiptType): string => (type === ReceiptType.TVA ? "T1" : "1");

async function generateNextReceiptNumber(
  tx: Prisma.TransactionClient,
  type: ReceiptType,
): Promise<string> {
  if (type === ReceiptType.TVA) {
    const latest = await tx.receipt.findFirst({
      where: {
        OR: [
          { type: ReceiptType.TVA },
          { receiptNo: { startsWith: "T", mode: "insensitive" } },
        ],
      },
      orderBy: { id: "desc" },
      select: { receiptNo: true },
    });
    const next = incrementReceiptNumber(latest?.receiptNo ?? null, defaultSeedForType(type));
    return enforceTPrefix(next);
  }

  const latest = await tx.receipt.findFirst({
    where: {
      AND: [
        { type: ReceiptType.NORMAL },
        { NOT: { receiptNo: { startsWith: "T", mode: "insensitive" } } },
      ],
    },
    orderBy: { id: "desc" },
    select: { receiptNo: true },
  });
  return incrementReceiptNumber(latest?.receiptNo ?? null, defaultSeedForType(type));
}

const parseOptionalBooleanFilter = (value: unknown): boolean | null => {
  if (value === undefined) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }
  return null;
};

router.get("/paginated", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 500);
    const pageRaw = req.query.page;
    const page = Math.max(pageRaw ? Number(pageRaw) || 1 : 1, 1);

    const where: Prisma.ReceiptWhereInput = {};
    const andFilters: Prisma.ReceiptWhereInput[] = [];

    const typeRaw = typeof req.query.type === "string" ? req.query.type.toUpperCase() : undefined;
    if (typeRaw) {
      if (!Object.values(ReceiptType).includes(typeRaw as ReceiptType)) {
        return res.status(400).json({ error: "Invalid type filter" });
      }
      where.type = typeRaw as ReceiptType;
    }

    if (req.query.customerId !== undefined) {
      const parsedCustomerId = Number(req.query.customerId);
      if (Number.isNaN(parsedCustomerId)) {
        return res.status(400).json({ error: "Invalid customerId" });
      }
      where.customerId = parsedCustomerId;
    }

    if (req.query.driverId !== undefined) {
      const parsedDriverId = Number(req.query.driverId);
      if (Number.isNaN(parsedDriverId)) {
        return res.status(400).json({ error: "Invalid driverId" });
      }
      where.driverId = parsedDriverId;
    }

    if (req.query.truckId !== undefined) {
      const parsedTruckId = Number(req.query.truckId);
      if (Number.isNaN(parsedTruckId)) {
        return res.status(400).json({ error: "Invalid truckId" });
      }
      where.truckId = parsedTruckId;
    }

    if (req.query.isPaid !== undefined) {
      const value = String(req.query.isPaid).toLowerCase();
      if (value === "true" || value === "1") {
        where.isPaid = true;
      } else if (value === "false" || value === "0") {
        where.isPaid = false;
      } else {
        return res.status(400).json({ error: "Invalid isPaid value" });
      }
    }

    const startDateRaw = typeof req.query.startDate === "string" ? req.query.startDate : undefined;
    if (startDateRaw) {
      const start = new Date(startDateRaw);
      if (Number.isNaN(start.getTime())) {
        return res.status(400).json({ error: "Invalid startDate value" });
      }
      const dateFilter: Prisma.DateTimeFilter<"Receipt"> =
        typeof where.date === "object" && where.date !== null && !(where.date instanceof Date)
          ? (where.date as Prisma.DateTimeFilter<"Receipt">)
          : {};
      dateFilter.gte = start;
      where.date = dateFilter;
    }

    const endDateRaw = typeof req.query.endDate === "string" ? req.query.endDate : undefined;
    if (endDateRaw) {
      const end = new Date(endDateRaw);
      if (Number.isNaN(end.getTime())) {
        return res.status(400).json({ error: "Invalid endDate value" });
      }
      // include entire day by setting time to end of day if only date string
      end.setHours(23, 59, 59, 999);
      const dateFilter: Prisma.DateTimeFilter<"Receipt"> =
        typeof where.date === "object" && where.date !== null && !(where.date instanceof Date)
          ? (where.date as Prisma.DateTimeFilter<"Receipt">)
          : {};
      dateFilter.lte = end;
      where.date = dateFilter;
    }

    const tehmilFilter = parseOptionalBooleanFilter(req.query.tehmil);
    if (req.query.tehmil !== undefined && tehmilFilter === null) {
      return res.status(400).json({ error: "Invalid tehmil filter" });
    }
    if (tehmilFilter !== null) {
      where.tehmil = tehmilFilter;
    }

    const tenzilFilter = parseOptionalBooleanFilter(req.query.tenzil);
    if (req.query.tenzil !== undefined && tenzilFilter === null) {
      return res.status(400).json({ error: "Invalid tenzil filter" });
    }
    if (tenzilFilter !== null) {
      where.tenzil = tenzilFilter;
    }

    const flaggedFilterRaw = parseOptionalBooleanFilter(req.query.flagged);
    if (req.query.flagged !== undefined && flaggedFilterRaw === null) {
      return res.status(400).json({ error: "Invalid flagged filter" });
    }
    if (flaggedFilterRaw === true) {
      andFilters.push({ OR: [{ tehmil: true }, { tenzil: true }] });
    } else if (flaggedFilterRaw === false) {
      andFilters.push({ tehmil: false, tenzil: false });
    }

    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    if (search.length > 0) {
      andFilters.push({
        OR: [
          { receiptNo: { contains: search, mode: "insensitive" } },
          { walkInName: { contains: search, mode: "insensitive" } },
          { customer: { name: { contains: search, mode: "insensitive" } } },
          { driver: { name: { contains: search, mode: "insensitive" } } },
          { truck: { plateNo: { contains: search, mode: "insensitive" } } },
        ],
      });
    }

    if (req.query.productId !== undefined && `${req.query.productId}`.trim() !== "") {
      const parsedProductId = Number(req.query.productId);
      if (Number.isNaN(parsedProductId)) {
        return res.status(400).json({ error: "Invalid productId" });
      }
      andFilters.push({
        items: {
          some: { productId: parsedProductId },
        },
      });
    }

    if (andFilters.length > 0) {
      where.AND = andFilters;
    }

    const totalItems = await prisma.receipt.count({ where });
    const totalPages = Math.max(Math.ceil(totalItems / limit) || 1, 1);
    const currentPage = Math.min(page, totalPages);
    const skip = (currentPage - 1) * limit;

    const sortFieldRaw = typeof req.query.sortField === "string" ? req.query.sortField : undefined;
    const sortOrderRaw = typeof req.query.sortOrder === "string" ? req.query.sortOrder : undefined;
    const sortOrder =
      sortOrderRaw && sortOrderRaw.toLowerCase() === "asc" ? "asc" : "desc";
    const allowedSortFields: Record<string, Prisma.ReceiptOrderByWithRelationInput> = {
      date: { date: sortOrder },
      receiptNo: { receiptNo: sortOrder },
      total: { total: sortOrder },
      amountPaid: { amountPaid: sortOrder },
    };
    const orderBy: Prisma.ReceiptOrderByWithRelationInput[] =
      sortFieldRaw && allowedSortFields[sortFieldRaw]
        ? [allowedSortFields[sortFieldRaw], { id: sortOrder as Prisma.SortOrder }]
        : [{ date: "desc" }, { id: "desc" }];

    const receipts = await prisma.receipt.findMany({
      where,
      include: receiptInclude,
      orderBy,
      skip,
      take: limit,
    });

    res.json({
      items: receipts,
      page: currentPage,
      pageSize: limit,
      totalItems,
      totalPages,
      hasNext: currentPage < totalPages,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch receipts" });
  }
});

const normalizePaymentInput = (rawAmount: unknown) => {
  if (rawAmount === null || rawAmount === undefined || `${rawAmount}`.trim().length === 0) {
    return null;
  }
  const parsed = Number(rawAmount);
  if (Number.isNaN(parsed) || parsed < 0) {
    return Number.NaN;
  }
  return parsed;
};

const normalizeOptionalQuantity = (rawValue: unknown) => {
  if (rawValue === null || rawValue === undefined || `${rawValue}`.trim().length === 0) {
    return null;
  }
  const parsed = Number(rawValue);
  if (Number.isNaN(parsed) || parsed < 0) {
    return Number.NaN;
  }
  return parsed;
};

const appendQuantityToNote = (quantity: number | null, note: string | null) => {
  if (quantity === null) {
    return note;
  }
  const quantityLabel = `Quantity: ${quantity}`;
  if (note && note.length > 0) {
    return `${quantityLabel} | ${note}`;
  }
  return quantityLabel;
};

router.post("/:id/tehmil-payment", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid receipt id" });
    }

    const receipt = await prisma.receipt.findUnique({
      where: { id },
      select: {
        id: true,
        receiptNo: true,
        tehmil: true,
        tehmilPaidAt: true,
      },
    });
    if (!receipt) {
      return res.status(404).json({ error: "Receipt not found" });
    }
    if (!receipt.tehmil) {
      return res.status(400).json({ error: "This receipt is not flagged for Tehmil" });
    }
    if (receipt.tehmilPaidAt) {
      return res.status(400).json({ error: "Tehmil payment already recorded for this receipt" });
    }

    const normalizedAmount = normalizePaymentInput(req.body?.amount);
    if (Number.isNaN(normalizedAmount)) {
      return res.status(400).json({ error: "amount must be zero or a positive number" });
    }
    const normalizedQuantity = normalizeOptionalQuantity(req.body?.quantity);
    if (Number.isNaN(normalizedQuantity)) {
      return res.status(400).json({ error: "quantity must be zero or a positive number" });
    }

    const paymentDateInput = req.body?.date;
    const paymentDate = paymentDateInput ? new Date(paymentDateInput) : new Date();
    if (Number.isNaN(paymentDate.getTime())) {
      return res.status(400).json({ error: "Invalid payment date" });
    }

    const normalizedNote =
      typeof req.body?.note === "string" && req.body.note.trim().length > 0
        ? req.body.note.trim()
        : null;

    const noteWithQuantity = appendQuantityToNote(normalizedQuantity, normalizedNote);

    await prisma.receipt.update({
      where: { id },
      data: {
        tehmilPaidAt: paymentDate,
        tehmilPaymentAmount: normalizedAmount,
        tehmilPaymentNote: noteWithQuantity,
      },
    });

    await logAudit({
      action: "TEHMIL_PAYMENT_RECORDED",
      entityType: "receipt",
      entityId: id,
      description: `Tehmil payment recorded for receipt ${receipt.receiptNo ?? id}`,
      user: req.user?.email ?? req.user?.name ?? null,
      metadata: {
        amount: normalizedAmount,
        date: paymentDate.toISOString(),
        quantity: normalizedQuantity,
      },
    });

    res.json({
      id,
      paidAt: paymentDate.toISOString(),
      amount: normalizedAmount,
      quantity: normalizedQuantity,
      note: noteWithQuantity,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to record Tehmil payment" });
  }
});

router.post("/:id/tenzil-payment", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid receipt id" });
    }

    const receipt = await prisma.receipt.findUnique({
      where: { id },
      select: {
        id: true,
        receiptNo: true,
        tenzil: true,
        tenzilPaidAt: true,
      },
    });
    if (!receipt) {
      return res.status(404).json({ error: "Receipt not found" });
    }
    if (!receipt.tenzil) {
      return res.status(400).json({ error: "This receipt is not flagged for Tenzil" });
    }
    if (receipt.tenzilPaidAt) {
      return res.status(400).json({ error: "Tenzil payment already recorded for this receipt" });
    }

    const normalizedAmount = normalizePaymentInput(req.body?.amount);
    if (Number.isNaN(normalizedAmount)) {
      return res.status(400).json({ error: "amount must be zero or a positive number" });
    }
    const normalizedQuantity = normalizeOptionalQuantity(req.body?.quantity);
    if (Number.isNaN(normalizedQuantity)) {
      return res.status(400).json({ error: "quantity must be zero or a positive number" });
    }

    const paymentDateInput = req.body?.date;
    const paymentDate = paymentDateInput ? new Date(paymentDateInput) : new Date();
    if (Number.isNaN(paymentDate.getTime())) {
      return res.status(400).json({ error: "Invalid payment date" });
    }

    const normalizedNote =
      typeof req.body?.note === "string" && req.body.note.trim().length > 0
        ? req.body.note.trim()
        : null;

    const noteWithQuantity = appendQuantityToNote(normalizedQuantity, normalizedNote);

    await prisma.receipt.update({
      where: { id },
      data: {
        tenzilPaidAt: paymentDate,
        tenzilPaymentAmount: normalizedAmount,
        tenzilPaymentNote: noteWithQuantity,
      },
    });

    await logAudit({
      action: "TENZIL_PAYMENT_RECORDED",
      entityType: "receipt",
      entityId: id,
      description: `Tenzil payment recorded for receipt ${receipt.receiptNo ?? id}`,
      user: req.user?.email ?? req.user?.name ?? null,
      metadata: {
        amount: normalizedAmount,
        date: paymentDate.toISOString(),
        quantity: normalizedQuantity,
      },
    });

    res.json({
      id,
      paidAt: paymentDate.toISOString(),
      amount: normalizedAmount,
      quantity: normalizedQuantity,
      note: noteWithQuantity,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to record Tenzil payment" });
  }
});

router.post("/flags/bulk-payment", async (req, res) => {
  try {
    const { type, startDate, endDate, amount, note, date } = req.body ?? {};
    const normalizedType = typeof type === "string" ? type.trim().toUpperCase() : "";
    if (normalizedType !== "TEHMIL" && normalizedType !== "TENZIL") {
      return res.status(400).json({ error: "type must be TEHMIL or TENZIL" });
    }

    if (typeof startDate !== "string" || startDate.trim().length === 0) {
      return res.status(400).json({ error: "startDate is required" });
    }
    if (typeof endDate !== "string" || endDate.trim().length === 0) {
      return res.status(400).json({ error: "endDate is required" });
    }
    const parsedStart = new Date(startDate);
    const parsedEnd = new Date(endDate);
    if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime())) {
      return res.status(400).json({ error: "Invalid startDate or endDate" });
    }
    if (parsedStart > parsedEnd) {
      return res.status(400).json({ error: "startDate must be before endDate" });
    }

    const normalizedAmount = normalizePaymentInput(amount);
    if (normalizedAmount === null || Number.isNaN(normalizedAmount) || normalizedAmount <= 0) {
      return res.status(400).json({ error: "amount must be a positive number" });
    }

    const paymentDate = date ? new Date(date) : new Date();
    if (Number.isNaN(paymentDate.getTime())) {
      return res.status(400).json({ error: "Invalid payment date" });
    }

    const where = buildFlaggedWhere(
      normalizedType as "TEHMIL" | "TENZIL",
      parsedStart,
      parsedEnd,
    );

    const dueReceipts = await prisma.receipt.findMany({
      where,
      orderBy: [{ date: "asc" }, { id: "asc" }],
      select: {
        id: true,
        receiptNo: true,
        total: true,
        amountPaid: true,
      },
    });

    if (dueReceipts.length === 0) {
      return res
        .status(400)
        .json({ error: "No flagged receipts found in the selected date range." });
    }

    const outstandingList = dueReceipts.map((receipt) => ({
      id: receipt.id,
      receiptNo: receipt.receiptNo ?? `#${receipt.id}`,
      outstanding: Math.max(Number(receipt.total) - Number(receipt.amountPaid ?? 0), 0),
    }));

    const totalOutstanding = outstandingList.reduce((sum, entry) => sum + entry.outstanding, 0);

    if (totalOutstanding <= 0) {
      return res.status(400).json({
        error: "Selected receipts have no outstanding balance.",
      });
    }

    if (normalizedAmount + 1e-6 < totalOutstanding) {
      return res.status(400).json({
        error: `Amount must be at least ${totalOutstanding.toFixed(2)} to cover all selected receipts.`,
      });
    }

    const rangeLabel =
      parsedStart.toISOString().slice(0, 10) === parsedEnd.toISOString().slice(0, 10)
        ? parsedStart.toISOString().slice(0, 10)
        : `${parsedStart.toISOString().slice(0, 10)} - ${parsedEnd.toISOString().slice(0, 10)}`;
    const normalizedNote =
      typeof note === "string" && note.trim().length > 0 ? note.trim() : null;
    const appendedNote = normalizedNote
      ? `${normalizedNote} (${rangeLabel})`
      : `Bulk payment (${rangeLabel})`;

    const paidField =
      normalizedType === "TEHMIL" ? "tehmilPaidAt" : ("tenzilPaidAt" as keyof Prisma.ReceiptUpdateInput);
    const amountField =
      normalizedType === "TEHMIL"
        ? "tehmilPaymentAmount"
        : ("tenzilPaymentAmount" as keyof Prisma.ReceiptUpdateInput);
    const noteField =
      normalizedType === "TEHMIL"
        ? "tehmilPaymentNote"
        : ("tenzilPaymentNote" as keyof Prisma.ReceiptUpdateInput);

    await prisma.$transaction(async (tx) => {
      for (const entry of outstandingList) {
        const updateData: Prisma.ReceiptUpdateInput = {
          [paidField]: paymentDate,
          [amountField]: entry.outstanding,
          [noteField]: appendedNote,
        };
        await tx.receipt.update({
          where: { id: entry.id },
          data: updateData,
        });
      }
    });

    await logAudit({
      action: normalizedType === "TEHMIL" ? "TEHMIL_BULK_PAYMENT" : "TENZIL_BULK_PAYMENT",
      entityType: "receipt",
      entityId: null,
      description: `${normalizedType} bulk payment recorded for ${outstandingList.length} receipts`,
      user: req.user?.email ?? req.user?.name ?? null,
      metadata: {
        type: normalizedType,
        startDate: parsedStart.toISOString(),
        endDate: parsedEnd.toISOString(),
        paymentDate: paymentDate.toISOString(),
        totalOutstanding,
        paidReceiptIds: outstandingList.map((entry) => entry.id),
      },
    });

    res.json({
      receiptCount: outstandingList.length,
      totalOutstanding,
      overpayment: Math.max(normalizedAmount - totalOutstanding, 0),
      paymentDate: paymentDate.toISOString(),
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to record bulk payment" });
  }
});

const buildFlaggedWhere = (
  type: "TEHMIL" | "TENZIL",
  startDate?: Date | null,
  endDate?: Date | null,
): Prisma.ReceiptWhereInput => {
  const where: Prisma.ReceiptWhereInput =
    type === "TEHMIL"
      ? { tehmil: true, tehmilPaidAt: null }
      : { tenzil: true, tenzilPaidAt: null };
  if (startDate || endDate) {
    where.date = {};
    if (startDate) {
      where.date.gte = startDate;
    }
    if (endDate) {
      where.date.lte = endDate;
    }
  }
  return where;
};

const parseOptionalDate = (value: unknown): Date | null => {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
};

router.get("/flags-summary", async (req, res) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 1000);
    const parsedStart = parseOptionalDate(req.query.startDate);
    const parsedEnd = parseOptionalDate(req.query.endDate);

    const selectFields = {
      id: true,
      receiptNo: true,
      date: true,
      total: true,
      amountPaid: true,
      customer: { select: { id: true, name: true } },
      walkInName: true,
    } satisfies Prisma.ReceiptSelect;

    const [tehmilDue, tenzilDue] = await Promise.all([
      prisma.receipt.findMany({
        where: buildFlaggedWhere("TEHMIL", parsedStart, parsedEnd),
        orderBy: [{ date: "asc" }, { id: "asc" }],
        take: limit,
        select: selectFields,
      }),
      prisma.receipt.findMany({
        where: buildFlaggedWhere("TENZIL", parsedStart, parsedEnd),
        orderBy: [{ date: "asc" }, { id: "asc" }],
        take: limit,
        select: selectFields,
      }),
    ]);

    res.json({
      summary: {
        tehmilDueCount: tehmilDue.length,
        tehmilDueTotal: 0,
        tenzilDueCount: tenzilDue.length,
        tenzilDueTotal: 0,
      },
      tehmilDue: tehmilDue.map((entry) => ({
        ...entry,
        total: 0,
        amountPaid: 0,
      })),
      tenzilDue: tenzilDue.map((entry) => ({
        ...entry,
        total: 0,
        amountPaid: 0,
      })),
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch Tehmil/Tenzil summary" });
  }
});

router.get("/tehmil-tenzil/weekly-summary", async (req, res) => {
  try {
    const startParam = req.query.start as string | undefined;
    const endParam = req.query.end as string | undefined;

    const now = new Date();
    const day = now.getDay(); // 0=Sun
    const diffToMonday = (day + 6) % 7;
    const defaultStart = new Date(now);
    defaultStart.setDate(now.getDate() - diffToMonday);
    defaultStart.setHours(0, 0, 0, 0);
    const defaultEnd = new Date(defaultStart);
    defaultEnd.setDate(defaultStart.getDate() + 7);
    defaultEnd.setMilliseconds(-1);

    const startDate = startParam ? new Date(startParam) : defaultStart;
    const endDate = endParam ? new Date(endParam) : defaultEnd;
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    const receipts = await prisma.receipt.findMany({
      where: {
        date: { gte: startDate, lte: endDate },
        OR: [
          { tehmil: true, tehmilPaidAt: null },
          { tenzil: true, tenzilPaidAt: null },
        ],
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      include: {
        customer: true,
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    const summary = receipts
      .map((receipt) => {
        let tehmilTotal = 0;
        let tenzilTotal = 0;
        receipt.items.forEach((item) => {
          const fee = item.product.tehmilFee ?? 0;
          if (receipt.tehmil) {
            tehmilTotal += (fee ?? 0) * item.quantity;
          }
          if (receipt.tenzil) {
            tenzilTotal += (fee ?? 0) * item.quantity;
          }
        });
        const total = tehmilTotal + tenzilTotal;
        return {
          id: receipt.id,
          date: receipt.date,
          receiptNo: receipt.receiptNo,
          customer: receipt.customer?.name ?? receipt.walkInName ?? "Walk-in",
          tehmilTotal,
          tenzilTotal,
          total,
        };
      })
      .filter((entry) => entry.total > 0);

    const grandTotal = summary.reduce((sum, entry) => sum + entry.total, 0);

    res.json({
      start: startDate,
      end: endDate,
      total: grandTotal,
      receipts: summary,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to compute Tehmil/Tenzil summary" });
  }
});

router.get("/next-number", async (_req, res) => {
  try {
    const [normalNext, tvaNext] = await prisma.$transaction(async (tx) => {
      const normal = await generateNextReceiptNumber(tx, ReceiptType.NORMAL);
      const tva = await generateNextReceiptNumber(tx, ReceiptType.TVA);
      return [normal, tva];
    });

    res.json({ normal: normalNext, tva: tvaNext });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to determine next receipt numbers" });
  }
});

// Create a receipt
router.post("/", async (req, res) => {
  try {
    const {
      receiptNo,
      customerId,
      jobSiteId,
      walkInName,
      driverId,
      truckId,
      tehmil,
      tenzil,
      date,
      isPaid = false,
      type = ReceiptType.NORMAL,
      items,
    } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "At least one line item is required" });
    }

    const parsedCustomerId =
      customerId === null || customerId === undefined ? null : Number(customerId);
    const parsedJobSiteId =
      jobSiteId === null || jobSiteId === undefined ? null : Number(jobSiteId);
    const parsedDriverId = driverId === null || driverId === undefined ? null : Number(driverId);
    const parsedTruckId = truckId === null || truckId === undefined ? null : Number(truckId);
    const cleanedWalkInName =
      typeof walkInName === "string" && walkInName.trim().length > 0 ? walkInName.trim() : null;
    const flagTehmil = parseBooleanFlag(tehmil);
    const flagTenzil = parseBooleanFlag(tenzil);

    if (Number.isNaN(parsedCustomerId ?? 0)) {
      return res.status(400).json({ error: "Invalid customerId" });
    }

    if (Number.isNaN(parsedJobSiteId ?? 0)) {
      return res.status(400).json({ error: "Invalid jobSiteId" });
    }

    if (parsedDriverId !== null && Number.isNaN(parsedDriverId)) {
      return res.status(400).json({ error: "Invalid driverId" });
    }

    if (parsedTruckId !== null && Number.isNaN(parsedTruckId)) {
      return res.status(400).json({ error: "Invalid truckId" });
    }

    if (parsedJobSiteId && !parsedCustomerId) {
      return res.status(400).json({ error: "A job site must be associated with a customer" });
    }

    if (!parsedCustomerId && !cleanedWalkInName) {
      return res
        .status(400)
        .json({ error: "Provide either a customerId or a walkInName for the receipt" });
    }

    if (parsedJobSiteId && parsedCustomerId) {
      const jobSite = await prisma.jobSite.findFirst({
        where: { id: parsedJobSiteId, customerId: parsedCustomerId },
      });
      if (!jobSite) {
        return res
          .status(400)
          .json({ error: "Selected job site does not belong to the chosen customer" });
      }
    }

    const normalizedItems: ReceiptItemInput[] = [];
    for (const rawItem of items) {
      const { productId } = rawItem;
      const quantity = Number(rawItem?.quantity);
      const { value: optionalDisplayQuantity, isValid: displayQuantityValid } = parseOptionalNumber(
        rawItem?.displayQuantity,
      );
      const { value: parsedUnitPrice, isValid: unitPriceValid } = parseOptionalNumber(rawItem?.unitPrice);
      const displayUnit =
        typeof rawItem?.displayUnit === "string" && rawItem.displayUnit.trim().length > 0
          ? rawItem.displayUnit.trim()
          : null;

      if (!productId || Number.isNaN(quantity) || quantity <= 0) {
        return res.status(400).json({ error: "Each item requires a productId and valid quantity" });
      }
      if (!displayQuantityValid) {
        return res.status(400).json({ error: "displayQuantity must be numeric when provided" });
      }
      if (!unitPriceValid) {
        return res.status(400).json({ error: "unitPrice must be numeric when provided" });
      }
      if (parsedUnitPrice !== null && parsedUnitPrice < 0) {
        return res.status(400).json({ error: "unitPrice cannot be negative" });
      }

      const subtotal = parsedUnitPrice !== null ? quantity * parsedUnitPrice : null;

      normalizedItems.push({
        productId: Number(productId),
        quantity,
        unitPrice: parsedUnitPrice,
        subtotal,
        displayQuantity:
          optionalDisplayQuantity !== null && !Number.isNaN(optionalDisplayQuantity) && optionalDisplayQuantity > 0
            ? optionalDisplayQuantity
            : null,
        displayUnit,
      });
    }

    const trimmedReceiptNo =
      typeof receiptNo === "string" && receiptNo.trim().length > 0 ? receiptNo.trim() : null;

    const normalizedType = String(type ?? ReceiptType.NORMAL).toUpperCase();
    if (!Object.values(ReceiptType).includes(normalizedType as ReceiptType)) {
      return res.status(400).json({ error: "type must be NORMAL or TVA" });
    }

    const inferredFromNumber =
      trimmedReceiptNo && trimmedReceiptNo.toUpperCase().startsWith("T")
        ? ReceiptType.TVA
        : null;

    let typedReceipt = normalizedType as ReceiptType;
    let lockedReceiptType: ReceiptType | null = null;

    if (parsedCustomerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: parsedCustomerId },
        select: { receiptType: true },
      });
      if (!customer) {
        return res.status(404).json({ error: "Customer not found" });
      }
      lockedReceiptType = customer.receiptType;
      typedReceipt = customer.receiptType;
    } else if (inferredFromNumber) {
      typedReceipt = inferredFromNumber;
    }

    if (lockedReceiptType && inferredFromNumber && lockedReceiptType !== inferredFromNumber) {
      return res.status(400).json({
        error: `Customer is locked to ${lockedReceiptType} receipts. Receipt number prefix does not match.`,
      });
    }

    if (typedReceipt === ReceiptType.TVA && trimmedReceiptNo && !trimmedReceiptNo.toUpperCase().startsWith("T")) {
      return res.status(400).json({ error: 'TVA receipts must start with "T"' });
    }

    if (typedReceipt === ReceiptType.NORMAL && trimmedReceiptNo && trimmedReceiptNo.toUpperCase().startsWith("T")) {
      return res.status(400).json({ error: "This customer is set to NORMAL receipts. Remove the T prefix." });
    }

    const hasPricedItems = normalizedItems.some((item) => item.subtotal !== null);
    const baseTotal = hasPricedItems
      ? normalizedItems.reduce((sum, item) => sum + (item.subtotal ?? 0), 0)
      : 0;
    const totalWithTax = applyReceiptTax(typedReceipt, baseTotal);
    const normalizedIsPaid = hasPricedItems && Boolean(isPaid);

    if (!normalizedIsPaid && !parsedCustomerId) {
      return res
        .status(400)
        .json({ error: "Unpaid receipts must be linked to a customer account." });
    }

    let attempts = 0;
    const maxAttempts = 5;
    while (attempts < maxAttempts) {
      try {
        const receipt = await prisma.$transaction(async (tx) => {
          const productIds = Array.from(new Set(normalizedItems.map((item) => item.productId)));
          const products = await tx.product.findMany({
            where: { id: { in: productIds } },
            select: receiptProductSelect,
          });
          const productMap = new Map(products.map((product) => [product.id, product]));

          const receiptNumberToUse = await requireNextReceiptNumber(
            tx,
            typedReceipt,
            trimmedReceiptNo,
          );

          const created = await tx.receipt.create({
            data: {
              receiptNo: receiptNumberToUse,
              customerId: parsedCustomerId,
              jobSiteId: parsedJobSiteId,
              walkInName: parsedCustomerId ? null : cleanedWalkInName,
              driverId: parsedDriverId,
              truckId: parsedTruckId,
              type: typedReceipt,
              tehmil: flagTehmil,
              tenzil: flagTenzil,
              total: totalWithTax,
              isPaid: normalizedIsPaid,
              amountPaid: normalizedIsPaid ? totalWithTax : 0,
              createdByUserId: req.user?.id ?? null,
              ...(date ? { date: new Date(date) } : {}),
              items: {
                create: normalizedItems.map((item) => ({
                  productId: item.productId,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice as any,
                  subtotal: item.subtotal as any,
                  displayQuantity: item.displayQuantity ?? null,
                  displayUnit: item.displayUnit ?? null,
                })),
              },
            },
            include: receiptInclude,
          });

          if (created.items.length !== normalizedItems.length) {
            throw new Error("RECEIPT_ITEM_MISMATCH");
          }

          for (let index = 0; index < normalizedItems.length; index += 1) {
            const item = normalizedItems[index];
            const createdItem = created.items[index];
            const product = productMap.get(createdItem.productId);
            const treatAsDebris = isDebrisProduct(product?.name);

            await tx.product.update({
              where: { id: createdItem.productId },
              data: {
                stockQty: treatAsDebris
                  ? { increment: item.quantity }
                  : { decrement: item.quantity },
              },
            });

            await tx.stockMovement.create({
              data: {
                productId: createdItem.productId,
                quantity: treatAsDebris ? item.quantity : -item.quantity,
                type: treatAsDebris ? StockMovementType.PURCHASE : StockMovementType.SALE,
                receiptId: created.id,
              },
            });

            await applyCompositeUsage(tx, {
              receiptId: created.id,
              receiptItemId: createdItem.id,
              product,
              quantity: item.quantity,
            });
          }

          return created;
        });

        await logAudit({
          action: "RECEIPT_CREATED",
          entityType: "receipt",
          entityId: receipt.id,
          description: `Receipt ${receipt.receiptNo ?? receipt.id} created for customer ${receipt.customerId ?? "walk-in"}`,
          user: req.user?.email ?? req.user?.name ?? null,
          metadata: { total: receipt.total, isPaid: receipt.isPaid },
        });

        res.json(receipt);
        return;
      } catch (err: any) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002" &&
          ((typeof err.meta?.target === "string" && err.meta.target.includes("receiptNo")) ||
            (Array.isArray(err.meta?.target) &&
              err.meta.target.some((target: any) => String(target).includes("receiptNo"))))
        ) {
          if (trimmedReceiptNo) {
            return res.status(409).json({ error: "Receipt number already exists. Choose another value." });
          }
          attempts += 1;
          continue;
        }
        throw err;
      }
    }

    return res
      .status(503)
      .json({ error: "Unable to generate a unique receipt number. Please try again." });
  } catch (err: any) {
    if (err instanceof ReceiptNumberValidationError) {
      return res.status(err.status).json(
        err.expectedNext
          ? { error: err.message, expectedNext: err.expectedNext }
          : { error: err.message },
      );
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id/number", async (req, res) => {
  try {
    if (req.user?.role !== UserRole.ADMIN) {
      return res.status(403).json({ error: "Only admins may override receipt numbers" });
    }
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid receipt id" });
    }
    const { receiptNo } = req.body ?? {};
    if (typeof receiptNo !== "string" || receiptNo.trim().length === 0) {
      return res.status(400).json({ error: "receiptNo is required" });
    }
    const trimmed = receiptNo.trim();
    const updated = await prisma.receipt.update({
      where: { id },
      data: { receiptNo: trimmed },
      include: receiptInclude,
    });
    await logAudit({
      action: "RECEIPT_NUMBER_OVERRIDE",
      entityType: "receipt",
      entityId: id,
      description: `Receipt number changed to ${trimmed}`,
      user: req.user?.email ?? req.user?.name ?? null,
      metadata: { receiptNo: trimmed },
    });
    res.json(updated);
  } catch (err: any) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      ((typeof err.meta?.target === "string" && err.meta.target.includes("receiptNo")) ||
        (Array.isArray(err.meta?.target) &&
          err.meta.target.some((target: any) => String(target).includes("receiptNo"))))
    ) {
      return res.status(409).json({ error: "That receipt number already exists" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update receipt number" });
  }
});

// Get all receipts
router.get("/", async (req, res) => {
  try {
    const receipts = await prisma.receipt.findMany({
      include: receiptInclude,
      orderBy: { date: "desc" },
    });
    res.json(receipts);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/customers/:customerId/invoice-preview", async (req, res) => {
  try {
    const { customerId } = req.params;
    const {
      receiptIds,
      amount,
      includePaid = false,
      priceOverrides: rawPriceOverrides,
      jobSiteId,
    } = req.body ?? {};

    const parsedCustomerId = Number(customerId);
    if (Number.isNaN(parsedCustomerId)) {
      return res.status(400).json({ error: "Invalid customer id" });
    }

    if ((!Array.isArray(receiptIds) || receiptIds.length === 0) && (amount === undefined || amount === null)) {
      return res.status(400).json({ error: "Provide receiptIds or an amount to invoice" });
    }

    const customer = await prisma.customer.findUnique({ where: { id: parsedCustomerId } });
    if (!customer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const priceOverrides: PriceOverridePayload[] = Array.isArray(rawPriceOverrides)
      ? rawPriceOverrides
          .map((override: any) => {
            const receiptId = Number(override?.receiptId);
            if (Number.isNaN(receiptId)) {
              return null;
            }
            const items = Array.isArray(override?.items)
              ? override.items
                  .map((entry: any) => {
                    const itemId = Number(entry?.itemId);
                    const price = Number(entry?.unitPrice);
                    if (Number.isNaN(itemId) || Number.isNaN(price) || price < 0) {
                      return null;
                    }
                    return { itemId, unitPrice: price };
                  })
                  .filter((entry: { itemId: number; unitPrice: number } | null) => entry !== null)
              : [];
            if (items.length === 0) {
              return null;
            }
            return { receiptId, items };
          })
          .filter((entry: PriceOverridePayload | null): entry is PriceOverridePayload => entry !== null)
      : [];

    if (priceOverrides.length > 0) {
      const auditedReceipts: { id: number; total: number }[] = [];
      await prisma.$transaction(async (tx) => {
        for (const override of priceOverrides) {
          const targetReceipt = await tx.receipt.findUnique({
            where: { id: override.receiptId },
            include: { items: true },
          });
          if (!targetReceipt || targetReceipt.customerId !== parsedCustomerId) {
            continue;
          }

          const overrideMap = new Map(override.items.map((item) => [item.itemId, item.unitPrice]));
          if (overrideMap.size === 0) {
            continue;
          }

          const itemsToUpdate = targetReceipt.items.filter((item) => overrideMap.has(item.id));
          if (itemsToUpdate.length === 0) {
            continue;
          }

          for (const item of itemsToUpdate) {
            const nextPrice = overrideMap.get(item.id);
            if (nextPrice === undefined) continue;
            await tx.receiptItem.update({
              where: { id: item.id },
              data: {
                unitPrice: nextPrice,
                subtotal: item.quantity * nextPrice,
              },
            });
          }

          const refreshedItems = await tx.receiptItem.findMany({ where: { receiptId: targetReceipt.id } });
          const updatedTotal = refreshedItems.reduce(
            (sum, item) => sum + Number(item.subtotal ?? 0),
            0,
          );
          const finalTotal = applyReceiptTax(targetReceipt.type, updatedTotal);
          let normalizedAmountPaid = Number(targetReceipt.amountPaid ?? 0);
          if (Number.isNaN(normalizedAmountPaid) || normalizedAmountPaid < 0) {
            normalizedAmountPaid = 0;
          }
          const computedIsPaid = finalTotal > 1e-6 && normalizedAmountPaid >= finalTotal - 1e-6;

          await tx.receipt.update({
            where: { id: targetReceipt.id },
            data: {
              total: finalTotal,
              isPaid: computedIsPaid,
            },
          });

          auditedReceipts.push({ id: targetReceipt.id, total: finalTotal });
        }
      });

      await Promise.all(
        auditedReceipts.map((entry) =>
          logAudit({
            action: "RECEIPT_PRICING_UPDATED",
            entityType: "receipt",
            entityId: entry.id,
            description: `Receipt ${entry.id} pricing updated via invoice builder`,
            user: req.user?.email ?? req.user?.name ?? null,
            metadata: { total: entry.total },
          }),
        ),
      );
    }

    let candidateReceipts = await prisma.receipt.findMany({
      where: {
        customerId: parsedCustomerId,
        ...(includePaid ? {} : { isPaid: false }),
        ...(jobSiteId
          ? {
              jobSiteId: Number(jobSiteId),
            }
          : {}),
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
      include: receiptInclude,
    });

    if (Array.isArray(receiptIds) && receiptIds.length > 0) {
      const idSet = new Set(receiptIds.map((id: any) => Number(id)).filter((id) => !Number.isNaN(id)));
      candidateReceipts = candidateReceipts.filter((receipt) => idSet.has(receipt.id));
      if (candidateReceipts.length === 0) {
        return res.status(400).json({ error: "No matching receipts found for this customer" });
      }
    } else if (amount !== undefined && amount !== null) {
      const target = Number(amount);
      if (Number.isNaN(target) || target <= 0) {
        return res.status(400).json({ error: "amount must be a positive number" });
      }
      const selected: typeof candidateReceipts = [];
      let running = 0;
      for (const receipt of candidateReceipts) {
        selected.push(receipt);
        running += Number(receipt.total);
        if (running >= target - 1e-6) {
          break;
        }
      }
      if (selected.length === 0) {
        return res.status(400).json({ error: "No receipts available to meet the requested amount" });
      }
      candidateReceipts = selected;
    }

    const receiptTypeSet = new Set(candidateReceipts.map((receipt) => receipt.type));
    if (receiptTypeSet.size > 1) {
      return res
        .status(400)
        .json({ error: "Invoices cannot mix NORMAL and TVA receipts. Please create separate invoices per type." });
    }

    const subtotal = candidateReceipts.reduce((sum, receipt) => sum + Number(receipt.total), 0);
    const amountPaid = candidateReceipts.reduce(
      (sum, receipt) => sum + Number(receipt.amountPaid ?? 0),
      0,
    );
    const invoiceType = candidateReceipts[0]?.type ?? ReceiptType.NORMAL;
    const isTvaInvoice = invoiceType === ReceiptType.TVA;
    const vatRate = isTvaInvoice ? TVA_RATE : 0;
    const vatAmount = isTvaInvoice ? Math.round(subtotal * vatRate * 100) / 100 : 0;
    const totalWithVat = subtotal + vatAmount;
    const normalizedAmountPaid = amountPaid;
    const outstanding = Math.max(totalWithVat - normalizedAmountPaid, 0);

    const oldBalance = await calculateCustomerOldBalance(
      parsedCustomerId,
      candidateReceipts.map((receipt) => receipt.id),
    );

    let jobSite = null;
    if (jobSiteId) {
      const parsedJobSiteId = Number(jobSiteId);
      if (Number.isNaN(parsedJobSiteId)) {
        return res.status(400).json({ error: "Invalid job site" });
      }
      jobSite = await prisma.jobSite.findFirst({
        where: { id: parsedJobSiteId, customerId: parsedCustomerId },
        select: { id: true, name: true },
      });
      if (!jobSite) {
        return res.status(400).json({ error: "Selected job site does not belong to this customer" });
      }
    }

    res.json({
      generatedAt: new Date(),
      customer,
      jobSite,
      invoice: {
        receiptCount: candidateReceipts.length,
        receipts: candidateReceipts,
        receiptType: invoiceType,
        subtotal,
        vatRate,
        vatAmount,
        totalWithVat,
        amountPaid: normalizedAmountPaid,
        outstanding,
        oldBalance,
      },
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to build invoice preview" });
  }
});

// Get one receipt
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const receipt = await prisma.receipt.findUnique({
      where: { id: Number(id) },
      include: receiptInclude,
    });
    if (!receipt) return res.status(404).json({ error: "Receipt not found" });
    res.json(receipt);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Update receipt (supports editing header + items + recalculating payments)
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const receiptId = Number(id);
    if (Number.isNaN(receiptId)) {
      return res.status(400).json({ error: "Invalid receipt id" });
    }

    const existing = await prisma.receipt.findUnique({
      where: { id: receiptId },
      include: {
        items: {
          include: { product: { select: { id: true, name: true } } },
        },
      },
    });

    if (!existing) {
      return res.status(404).json({ error: "Receipt not found" });
    }

    const {
      customerId,
      jobSiteId,
      walkInName,
      driverId,
      truckId,
      tehmil,
      tenzil,
      isPaid,
      date,
      type,
      items,
      amountPaid,
    } = req.body;

    const normalizedWalkInName =
      typeof walkInName === "string" && walkInName.trim().length > 0 ? walkInName.trim() : null;

    const updateData: Record<string, unknown> = {};
    let nextCustomerId: number | null | undefined = existing.customerId;

    if (customerId !== undefined) {
      if (customerId === null) {
        nextCustomerId = null;
        updateData.customerId = null;
        updateData.walkInName = normalizedWalkInName;
        updateData.jobSiteId = null;
      } else {
        const value = Number(customerId);
        if (Number.isNaN(value)) {
          return res.status(400).json({ error: "Invalid customerId" });
        }
        nextCustomerId = value;
        updateData.customerId = value;
        updateData.walkInName = null;
      }
    } else if (walkInName !== undefined) {
      updateData.walkInName = normalizedWalkInName;
    }

    if (jobSiteId !== undefined) {
      if (jobSiteId === null) {
        updateData.jobSiteId = null;
      } else {
        const value = Number(jobSiteId);
        if (Number.isNaN(value)) {
          return res.status(400).json({ error: "Invalid jobSiteId" });
        }
        const resultingCustomerId =
          nextCustomerId !== undefined ? nextCustomerId : existing.customerId;
        if (!resultingCustomerId) {
          return res
            .status(400)
            .json({ error: "A job site must belong to a customer account" });
        }
        const jobSite = await prisma.jobSite.findFirst({
          where: { id: value, customerId: resultingCustomerId },
        });
        if (!jobSite) {
          return res
            .status(400)
            .json({ error: "Selected job site does not belong to the chosen customer" });
        }
        updateData.jobSiteId = value;
      }
    }

    if (driverId !== undefined) {
      if (driverId === null) {
        updateData.driverId = null;
      } else {
        const value = Number(driverId);
        if (Number.isNaN(value)) {
          return res.status(400).json({ error: "Invalid driverId" });
        }
        updateData.driverId = value;
      }
    }

    if (truckId !== undefined) {
      if (truckId === null) {
        updateData.truckId = null;
      } else {
        const value = Number(truckId);
        if (Number.isNaN(value)) {
          return res.status(400).json({ error: "Invalid truckId" });
        }
        updateData.truckId = value;
      }
    }

    if (tehmil !== undefined) {
      updateData.tehmil = parseBooleanFlag(tehmil);
    }

    if (tenzil !== undefined) {
      updateData.tenzil = parseBooleanFlag(tenzil);
    }

    const requestedIsPaid = typeof isPaid === "boolean" ? isPaid : undefined;

    if (type !== undefined) {
      const normalizedType = String(type).toUpperCase();
      if (!Object.values(ReceiptType).includes(normalizedType as ReceiptType)) {
        return res.status(400).json({ error: "type must be NORMAL or TVA" });
      }
      updateData.type = normalizedType as ReceiptType;
    }

    if (date) {
      updateData.date = new Date(date);
    }

    let parsedAmountPaid: number | undefined;
    if (amountPaid !== undefined) {
      const value = Number(amountPaid);
      if (Number.isNaN(value) || value < 0) {
        return res.status(400).json({ error: "amountPaid must be zero or a positive number" });
      }
      parsedAmountPaid = value;
    }

    let normalizedItems: ReceiptItemInput[] | null = null;
    const existingBaseTotal = existing.items.reduce(
      (sum, item) => sum + Number(item.subtotal ?? 0),
      0,
    );
    let newTotal = existingBaseTotal;
    let nextHasPricedItems = existing.items.some((item) => item.subtotal !== null);

    if (items !== undefined) {
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "At least one line item is required" });
      }
      normalizedItems = [];
      for (const rawItem of items) {
        const { productId } = rawItem;
        const quantity = Number(rawItem?.quantity);
        const { value: optionalDisplayQuantity, isValid: displayQuantityValid } =
          parseOptionalNumber(rawItem?.displayQuantity);
        const { value: parsedUnitPrice, isValid: unitPriceValid } =
          parseOptionalNumber(rawItem?.unitPrice);
        const displayUnit =
          typeof rawItem?.displayUnit === "string" && rawItem.displayUnit.trim().length > 0
            ? rawItem.displayUnit.trim()
            : null;
        if (!productId || Number.isNaN(quantity) || quantity <= 0) {
          return res.status(400).json({ error: "Each item requires a productId and valid quantity" });
        }
        if (!displayQuantityValid) {
          return res.status(400).json({ error: "displayQuantity must be numeric when provided" });
        }
        if (!unitPriceValid) {
          return res.status(400).json({ error: "unitPrice must be numeric when provided" });
        }
        if (parsedUnitPrice !== null && parsedUnitPrice < 0) {
          return res.status(400).json({ error: "unitPrice cannot be negative" });
        }
        normalizedItems.push({
          productId: Number(productId),
          quantity,
          unitPrice: parsedUnitPrice,
          subtotal: parsedUnitPrice !== null ? quantity * parsedUnitPrice : null,
          displayQuantity:
            optionalDisplayQuantity !== null &&
            !Number.isNaN(optionalDisplayQuantity) &&
            optionalDisplayQuantity > 0
              ? optionalDisplayQuantity
              : null,
          displayUnit,
        });
      }
      const normalizedHasPricedItems = normalizedItems.some((item) => item.subtotal !== null);
      nextHasPricedItems = normalizedHasPricedItems;
      newTotal = normalizedHasPricedItems
        ? normalizedItems.reduce((sum, item) => sum + (item.subtotal ?? 0), 0)
        : 0;
    }

    const updated = await prisma.$transaction(async (tx) => {
      const current = await tx.receipt.findUnique({
        where: { id: receiptId },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true } },
              compositeUsages: {
                include: {
                  componentProduct: {
                    select: { id: true, name: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!current) {
        throw new Error("NOT_FOUND");
      }

      if (normalizedItems) {
        await tx.stockMovement.deleteMany({ where: { receiptId } });

        for (const item of current.items) {
          const treatAsDebris = isDebrisProduct(item.product?.name);
          await tx.product.update({
            where: { id: item.productId },
            data: treatAsDebris
              ? { stockQty: { decrement: item.quantity } }
              : { stockQty: { increment: item.quantity } },
          });
          await revertCompositeUsage(tx, item.compositeUsages);
        }

        await tx.receiptItem.deleteMany({ where: { receiptId } });

        const productIds = Array.from(new Set(normalizedItems.map((item) => item.productId)));
        const products = await tx.product.findMany({
          where: { id: { in: productIds } },
          select: receiptProductSelect,
        });
        const productMap = new Map(products.map((product) => [product.id, product]));

        for (const item of normalizedItems) {
          const product = productMap.get(item.productId);
          const treatAsDebris = isDebrisProduct(product?.name);
          const createdItem = await tx.receiptItem.create({
            data: {
              receiptId,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice as any,
              subtotal: item.subtotal as any,
              displayQuantity: item.displayQuantity ?? null,
              displayUnit: item.displayUnit ?? null,
            },
          });

          await tx.product.update({
            where: { id: item.productId },
            data: treatAsDebris
              ? { stockQty: { increment: item.quantity } }
              : { stockQty: { decrement: item.quantity } },
          });

          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              quantity: treatAsDebris ? item.quantity : -item.quantity,
              type: treatAsDebris ? StockMovementType.PURCHASE : StockMovementType.SALE,
              receiptId,
            },
          });

          await applyCompositeUsage(tx, {
            receiptId,
            receiptItemId: createdItem.id,
            product,
            quantity: item.quantity,
          });
        }
      }

      const finalHasPricedItems = normalizedItems
        ? nextHasPricedItems
        : current.items.some((item) => item.subtotal !== null);
      const activeType = (updateData.type ?? current.type) as ReceiptType;
      const currentBaseTotal = current.items.reduce(
        (sum, item) => sum + Number(item.subtotal ?? 0),
        0,
      );
      const finalBaseTotal = normalizedItems ? newTotal : currentBaseTotal;
      const paymentsAggregation = await tx.receiptPayment.aggregate({
        where: { receiptId },
        _sum: { amount: true },
      });
      const amountFromAllocations = Number(paymentsAggregation._sum.amount ?? 0);
      if (parsedAmountPaid !== undefined && parsedAmountPaid + 1e-6 < amountFromAllocations) {
        throw new Error("PAID_BELOW_ALLOCATIONS");
      }

      const baseAmountPaid = parsedAmountPaid ?? Math.max(current.amountPaid, amountFromAllocations);
      const finalTotal = finalHasPricedItems ? applyReceiptTax(activeType, finalBaseTotal) : 0;
      let finalAmountPaid = finalHasPricedItems ? Math.min(baseAmountPaid, finalTotal) : 0;

      if (Number.isNaN(finalAmountPaid) || finalAmountPaid < 0) {
        finalAmountPaid = 0;
      }

      if (requestedIsPaid === false && parsedAmountPaid === undefined) {
        finalAmountPaid = Math.min(amountFromAllocations, finalTotal);
      }

      let finalIsPaid: boolean;
      if (requestedIsPaid !== undefined) {
        finalIsPaid =
          finalHasPricedItems && requestedIsPaid && finalAmountPaid >= finalTotal - 1e-6;
      } else {
        finalIsPaid = finalHasPricedItems && finalAmountPaid >= finalTotal - 1e-6;
      }

      const persisted = await tx.receipt.update({
        where: { id: receiptId },
        data: {
          ...updateData,
          total: finalTotal,
          amountPaid: finalAmountPaid,
          isPaid: finalIsPaid,
        },
        include: receiptInclude,
      });

      return persisted;
    });

    await logAudit({
      action: "RECEIPT_UPDATED",
      entityType: "receipt",
      entityId: updated.id,
      description: `Receipt ${updated.receiptNo ?? updated.id} updated`,
      user: req.user?.email ?? req.user?.name ?? null,
      metadata: {
        total: Number(updated.total),
        amountPaid: Number(updated.amountPaid),
        isPaid: updated.isPaid,
      },
    });

    res.json(updated);
  } catch (err: any) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Receipt not found" });
    }
    if (err instanceof Error && err.message === "PAID_BELOW_ALLOCATIONS") {
      return res
        .status(400)
        .json({ error: "amountPaid cannot be less than existing allocated payments" });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Delete receipt (cascade deletes items automatically if Prisma is configured)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const receiptId = Number(id);
    if (Number.isNaN(receiptId)) {
      return res.status(400).json({ error: "Invalid receipt id" });
    }

    const deletedInfo = await prisma.$transaction(async (tx) => {
      const receipt = await tx.receipt.findUnique({
        where: { id: receiptId },
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true } },
              compositeUsages: {
                include: {
                  componentProduct: {
                    select: { id: true, name: true },
                  },
                },
              },
            },
          },
          receiptPayments: true,
          payments: true,
        },
      });

      if (!receipt) {
        throw new Error("NOT_FOUND");
      }

      await tx.stockMovement.deleteMany({ where: { receiptId } });

      for (const item of receipt.items) {
        const treatAsDebris = isDebrisProduct(item.product?.name);
        await tx.product.update({
          where: { id: item.productId },
          data: treatAsDebris
            ? { stockQty: { decrement: item.quantity } }
            : { stockQty: { increment: item.quantity } },
        });
        await revertCompositeUsage(tx, item.compositeUsages);
      }

      if (receipt.receiptPayments.length > 0) {
        await tx.receiptPayment.deleteMany({ where: { receiptId } });
      }

      if (receipt.payments.length > 0) {
        await tx.payment.updateMany({
          where: { id: { in: receipt.payments.map((payment) => payment.id) } },
          data: { receiptId: null },
        });
      }

      await tx.receiptItem.deleteMany({ where: { receiptId } });
      await tx.receipt.delete({ where: { id: receiptId } });

      return {
        id: receipt.id,
        receiptNo: receipt.receiptNo,
        total: Number(receipt.total),
        customerId: receipt.customerId,
      };
    });

    await logAudit({
      action: "RECEIPT_DELETED",
      entityType: "receipt",
      entityId: deletedInfo.id,
      description: `Receipt ${deletedInfo.receiptNo ?? deletedInfo.id} deleted`,
      user: req.user?.email ?? req.user?.name ?? null,
      metadata: {
        total: deletedInfo.total,
        customerId: deletedInfo.customerId,
      },
    });

    res.json({ message: "Receipt deleted" });
  } catch (err: any) {
    if (err instanceof Error && err.message === "NOT_FOUND") {
      return res.status(404).json({ error: "Receipt not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
const receiptProductSelect = {
  id: true,
  name: true,
  isComposite: true,
  compositeComponents: {
    select: {
      componentProductId: true,
      quantity: true,
      componentProduct: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.ProductSelect;

type ReceiptProduct = Prisma.ProductGetPayload<{ select: typeof receiptProductSelect }>;

type ReceiptItemCompositeUsage = Prisma.ReceiptItemComponentGetPayload<{
  include: {
    componentProduct: {
      select: {
        id: true;
        name: true;
      };
    };
  };
}>;

const buildCompositeEntries = (product: ReceiptProduct | undefined, quantity: number) => {
  if (!product?.isComposite || !product?.compositeComponents?.length || quantity <= 0) {
    return [];
  }
  return product.compositeComponents
    .map((component) => ({
      componentProductId: component.componentProductId,
      componentName: component.componentProduct?.name ?? null,
      amount: component.quantity * quantity,
    }))
    .filter((entry) => entry.amount > 0);
};

async function applyCompositeUsage(
  tx: Prisma.TransactionClient,
  {
    receiptId,
    receiptItemId,
    product,
    quantity,
  }: {
    receiptId: number;
    receiptItemId: number;
    product: ReceiptProduct | undefined;
    quantity: number;
  },
) {
  const entries = buildCompositeEntries(product, quantity);
  if (!entries.length) return;

  for (const entry of entries) {
    await tx.receiptItemComponent.create({
      data: {
        receiptItemId,
        componentProductId: entry.componentProductId,
        quantity: entry.amount,
      },
    });

    const treatAsDebris = isDebrisProduct(entry.componentName);
    await tx.product.update({
      where: { id: entry.componentProductId },
      data: treatAsDebris
        ? { stockQty: { increment: entry.amount } }
        : { stockQty: { decrement: entry.amount } },
    });

    await tx.stockMovement.create({
      data: {
        productId: entry.componentProductId,
        quantity: treatAsDebris ? entry.amount : -entry.amount,
        type: treatAsDebris ? StockMovementType.PURCHASE : StockMovementType.SALE,
        receiptId,
      },
    });
  }
}

async function revertCompositeUsage(
  tx: Prisma.TransactionClient,
  usages: ReceiptItemCompositeUsage[] | undefined,
) {
  if (!usages || usages.length === 0) return;
  for (const usage of usages) {
    const treatAsDebris = isDebrisProduct(usage.componentProduct?.name);
    await tx.product.update({
      where: { id: usage.componentProductId },
      data: treatAsDebris
        ? { stockQty: { decrement: usage.quantity } }
        : { stockQty: { increment: usage.quantity } },
    });
  }
}
