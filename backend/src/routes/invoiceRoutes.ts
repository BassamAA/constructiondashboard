import { Router } from "express";
import {
  InvoiceStatus,
  PaymentType,
  Prisma,
  ReceiptType,
  UserRole,
} from "@prisma/client";
import prisma from "../prismaClient";
import { logAudit } from "../utils/auditLogger";
import { receiptInclude } from "../utils/receiptInclude";
import { requireRole } from "../middleware/auth";
import { calculateCustomerOldBalance } from "../utils/outstandingBalance";

const router = Router();
const TVA_RATE = 0.11;
const TAX_MULTIPLIER = 1 + TVA_RATE;

const invoiceInclude = {
  customer: true,
  jobSite: { select: { id: true, name: true } },
  invoiceReceipts: {
    include: {
      receipt: {
        include: receiptInclude,
      },
    },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceWithRelations = Prisma.InvoiceGetPayload<{
  include: typeof invoiceInclude;
}>;

type InvoicePayload = {
  receiptIds?: number[];
  amount?: number;
  includePaid?: boolean;
  notes?: string | null;
  jobSiteId?: number | null;
};

const formatCurrency = (value: number) => Number(value.toFixed(2));

const formatInvoiceResponse = (invoice: InvoiceWithRelations, oldBalance: number) => {
  const receipts = invoice.invoiceReceipts.map((link) => link.receipt);
  return {
    id: invoice.id,
    invoiceNo: invoice.invoiceNo,
    status: invoice.status,
    issuedAt: invoice.issuedAt,
    paidAt: invoice.paidAt,
    notes: invoice.notes,
    generatedAt: invoice.issuedAt,
    customer: invoice.customer,
    jobSite: invoice.jobSite ?? null,
    invoice: {
      receiptCount: receipts.length,
      receipts,
      receiptType: invoice.receiptType,
      subtotal: invoice.subtotal,
      vatRate: invoice.vatRate ?? undefined,
      vatAmount: invoice.vatAmount ?? undefined,
      totalWithVat: invoice.total,
      amountPaid: invoice.amountPaid,
      outstanding: invoice.outstanding,
      oldBalance,
    },
  };
};

const selectReceiptsForInvoice = async (
  customerId: number,
  payload: InvoicePayload,
) => {
  const { receiptIds, amount, includePaid = false } = payload;

  if (
    (!Array.isArray(receiptIds) || receiptIds.length === 0) &&
    (amount === undefined || amount === null)
  ) {
    throw new Error("Provide receiptIds or an amount to invoice");
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });
  if (!customer) {
    throw new Error("CUSTOMER_NOT_FOUND");
  }

  let candidateReceipts = await prisma.receipt.findMany({
    where: {
      customerId,
      ...(includePaid ? {} : { isPaid: false }),
    },
    orderBy: [{ date: "asc" }, { id: "asc" }],
    include: receiptInclude,
  });

  if (Array.isArray(receiptIds) && receiptIds.length > 0) {
    const idSet = new Set(
      receiptIds.map((id) => Number(id)).filter((id) => !Number.isNaN(id)),
    );
    candidateReceipts = candidateReceipts.filter((receipt) =>
      idSet.has(receipt.id),
    );
    if (candidateReceipts.length === 0) {
      throw new Error("NO_MATCHING_RECEIPTS");
    }
  } else if (amount !== undefined && amount !== null) {
    const targetAmount = Number(amount);
    if (Number.isNaN(targetAmount) || targetAmount <= 0) {
      throw new Error("INVALID_AMOUNT");
    }
    const selected: typeof candidateReceipts = [];
    let running = 0;
    for (const receipt of candidateReceipts) {
      selected.push(receipt);
      running += Number(receipt.total);
      if (running >= targetAmount - 1e-6) {
        break;
      }
    }
    if (selected.length === 0) {
      throw new Error("NO_RECEIPTS_FOR_AMOUNT");
    }
    candidateReceipts = selected;
  }

  const receiptTypeSet = new Set(candidateReceipts.map((receipt) => receipt.type));
  if (receiptTypeSet.size > 1) {
    throw new Error("MIXED_RECEIPT_TYPES");
  }

  const receiptType = candidateReceipts[0]?.type ?? ReceiptType.NORMAL;
  const sanitizedReceipts = candidateReceipts;

  const subtotal = sanitizedReceipts.reduce(
    (sum, receipt) => sum + Number(receipt.total),
    0,
  );
  const vatRate = receiptType === ReceiptType.TVA ? TVA_RATE : 0;
  const vatAmount =
    vatRate > 0 ? formatCurrency(subtotal * (TAX_MULTIPLIER - 1)) : 0;
  const totalWithVat = formatCurrency(subtotal + vatAmount);
  const amountPaid = sanitizedReceipts.reduce(
    (sum, receipt) => sum + Number(receipt.amountPaid ?? 0),
    0,
  );
  const outstanding = Math.max(totalWithVat - amountPaid, 0);

  const linkedInvoices = await prisma.invoiceReceipt.findMany({
    where: {
      receiptId: {
        in: sanitizedReceipts.map((receipt) => receipt.id),
      },
    },
    include: {
      invoice: {
        select: {
          id: true,
          invoiceNo: true,
          status: true,
        },
      },
    },
  });

  if (linkedInvoices.length > 0) {
    throw new Error("RECEIPT_ALREADY_INVOICED");
  }

  const oldBalance = await calculateCustomerOldBalance(
    customerId,
    sanitizedReceipts.map((receipt) => receipt.id),
  );

  return {
    customer,
    receipts: sanitizedReceipts,
    receiptType,
    subtotal,
    vatRate,
    vatAmount,
    totalWithVat,
    amountPaid,
    outstanding,
    oldBalance,
  };
};

router.get("/", async (req, res) => {
  try {
    const { status, customerId } = req.query;
    const where: Prisma.InvoiceWhereInput = {};

    if (status) {
      const normalizedStatus = String(status).toUpperCase();
      if (!Object.values(InvoiceStatus).includes(normalizedStatus as InvoiceStatus)) {
        return res.status(400).json({ error: "Invalid invoice status filter" });
      }
      where.status = normalizedStatus as InvoiceStatus;
    }

    if (customerId) {
      const parsed = Number(customerId);
      if (Number.isNaN(parsed)) {
        return res.status(400).json({ error: "Invalid customerId" });
      }
      where.customerId = parsed;
    }

    const invoices = await prisma.invoice.findMany({
      where,
      include: invoiceInclude,
      orderBy: { issuedAt: "desc" },
    });

    const enriched = await Promise.all(
      invoices.map(async (invoice) => {
        const receiptIds = invoice.invoiceReceipts.map((link) => link.receiptId);
        const oldBalance = await calculateCustomerOldBalance(invoice.customerId, receiptIds);
        return formatInvoiceResponse(invoice, oldBalance);
      }),
    );

    res.json(enriched);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to load invoices" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid invoice id" });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    const receiptIds = invoice.invoiceReceipts.map((link) => link.receiptId);
    const oldBalance = await calculateCustomerOldBalance(invoice.customerId, receiptIds);
    res.json(formatInvoiceResponse(invoice, oldBalance));
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch invoice" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { customerId, receiptIds, amount, includePaid, notes, jobSiteId } = req.body ?? {};
    const parsedCustomerId = Number(customerId);
    if (Number.isNaN(parsedCustomerId)) {
      return res.status(400).json({ error: "Invalid customer id" });
    }

    const selection = await selectReceiptsForInvoice(parsedCustomerId, {
      receiptIds,
      amount,
      includePaid,
      notes,
      jobSiteId,
    });

    if (jobSiteId) {
      const parsedJobSiteId = Number(jobSiteId);
      if (Number.isNaN(parsedJobSiteId)) {
        return res.status(400).json({ error: "Invalid job site" });
      }
      const jobSite = await prisma.jobSite.findFirst({
        where: { id: parsedJobSiteId, customerId: parsedCustomerId },
        select: { id: true },
      });
      if (!jobSite) {
        return res.status(400).json({ error: "Selected job site does not belong to this customer" });
      }
    }

    const status =
      selection.outstanding <= 1e-6 ? InvoiceStatus.PAID : InvoiceStatus.PENDING;
    const paidAtValue = status === InvoiceStatus.PAID ? new Date() : null;

    const createdInvoice = await prisma.$transaction(async (tx) => {
      let invoice = await tx.invoice.create({
        data: {
          customerId: parsedCustomerId,
          jobSiteId:
            jobSiteId && `${jobSiteId}`.trim().length > 0 && !Number.isNaN(Number(jobSiteId))
              ? Number(jobSiteId)
              : null,
          receiptType: selection.receiptType,
          status,
          subtotal: selection.subtotal,
          vatRate: selection.vatRate > 0 ? selection.vatRate : null,
          vatAmount: selection.vatRate > 0 ? selection.vatAmount : null,
          total: selection.totalWithVat,
          amountPaid: Math.min(selection.amountPaid, selection.totalWithVat),
          outstanding: Math.max(selection.totalWithVat - selection.amountPaid, 0),
          notes: typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null,
          paidAt: paidAtValue,
        },
      });

      await tx.invoiceReceipt.createMany({
        data: selection.receipts.map((receipt) => ({
          invoiceId: invoice.id,
          receiptId: receipt.id,
        })),
      });

      if (!invoice.invoiceNo) {
        const invoiceNo = `INV-${String(invoice.id).padStart(5, "0")}`;
        invoice = await tx.invoice.update({
          where: { id: invoice.id },
          data: { invoiceNo },
        });
      }

      return invoice;
    });

    const fresh = await prisma.invoice.findUnique({
      where: { id: createdInvoice.id },
      include: invoiceInclude,
    });

    if (!fresh) {
      return res.status(500).json({ error: "Failed to load created invoice" });
    }

    await logAudit({
      action: "INVOICE_CREATED",
      entityType: "invoice",
      entityId: fresh.id,
      description: `Invoice ${fresh.invoiceNo ?? fresh.id} created with ${
        fresh.invoiceReceipts.length
      } receipts`,
      metadata: {
        customerId: fresh.customerId,
        subtotal: fresh.subtotal,
        total: fresh.total,
      },
    });

    const freshReceiptIds = fresh.invoiceReceipts.map((link) => link.receiptId);
    const oldBalance = await calculateCustomerOldBalance(fresh.customerId, freshReceiptIds);
    res.status(201).json(formatInvoiceResponse(fresh, oldBalance));
  } catch (err: any) {
    if (err instanceof Error) {
      if (err.message === "CUSTOMER_NOT_FOUND") {
        return res.status(404).json({ error: "Customer not found" });
      }
      if (err.message === "NO_MATCHING_RECEIPTS") {
        return res.status(400).json({ error: "No matching receipts found for this customer" });
      }
      if (err.message === "INVALID_AMOUNT") {
        return res.status(400).json({ error: "amount must be a positive number" });
      }
      if (err.message === "NO_RECEIPTS_FOR_AMOUNT") {
        return res.status(400).json({ error: "No receipts available to meet the requested amount" });
      }
      if (err.message === "MIXED_RECEIPT_TYPES") {
        return res.status(400).json({ error: "Invoices cannot mix NORMAL and TVA receipts. Please create separate invoices per type." });
      }
      if (err.message === "RECEIPT_ALREADY_INVOICED") {
        return res.status(400).json({ error: "One or more receipts have already been invoiced." });
      }
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to create invoice" });
  }
});

router.post("/:id/mark-paid", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid invoice id" });
    }

    const paidAtInput = req.body?.paidAt;
    const paidAt = paidAtInput ? new Date(paidAtInput) : new Date();
    if (Number.isNaN(paidAt.getTime())) {
      return res.status(400).json({ error: "Invalid paidAt date" });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: invoiceInclude,
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    if (invoice.status === InvoiceStatus.PAID) {
      return res.status(400).json({ error: "Invoice already marked as paid" });
    }

    const outstanding = Math.max(invoice.total - invoice.amountPaid, 0);
    if (outstanding <= 1e-6) {
      const updatedNoPayment = await prisma.invoice.update({
        where: { id },
        data: {
          status: InvoiceStatus.PAID,
          outstanding: 0,
          amountPaid: invoice.total,
          paidAt,
        },
        include: invoiceInclude,
      });
      const receiptIds = updatedNoPayment.invoiceReceipts.map((link) => link.receiptId);
      const oldBalance = await calculateCustomerOldBalance(
        updatedNoPayment.customerId,
        receiptIds,
      );
      return res.json(formatInvoiceResponse(updatedNoPayment, oldBalance));
    }

    const updatedInvoice = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          date: paidAt,
          amount: outstanding,
          type: PaymentType.CUSTOMER_PAYMENT,
          customerId: invoice.customerId,
          description: `Invoice ${invoice.invoiceNo ?? invoice.id} payment`,
        },
      });

      let remaining = outstanding;

      for (const link of invoice.invoiceReceipts) {
        if (remaining <= 0) break;
        const current = await tx.receipt.findUnique({
          where: { id: link.receiptId },
        });
        if (!current) continue;
        const currentOutstanding = Math.max(
          Number(current.total) - Number(current.amountPaid ?? 0),
          0,
        );
        if (currentOutstanding <= 0) continue;
        const applied = Math.min(currentOutstanding, remaining);
        if (applied <= 0) continue;
        await tx.receiptPayment.create({
          data: {
            paymentId: payment.id,
            receiptId: current.id,
            amount: applied,
          },
        });
        const newAmountPaid = Number(current.amountPaid ?? 0) + applied;
        await tx.receipt.update({
          where: { id: current.id },
          data: {
            amountPaid: newAmountPaid,
            isPaid: newAmountPaid >= Number(current.total) - 1e-6,
          },
        });
        remaining -= applied;
      }

      return tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: InvoiceStatus.PAID,
          amountPaid: invoice.total,
          outstanding: 0,
          paidAt,
        },
        include: invoiceInclude,
      });
    });

    await logAudit({
      action: "INVOICE_PAID",
      entityType: "invoice",
      entityId: updatedInvoice.id,
      description: `Invoice ${updatedInvoice.invoiceNo ?? updatedInvoice.id} marked as paid`,
      metadata: {
        total: updatedInvoice.total,
        paidAt: paidAt.toISOString(),
      },
    });

    const receiptIds = updatedInvoice.invoiceReceipts.map((link) => link.receiptId);
    const oldBalance = await calculateCustomerOldBalance(updatedInvoice.customerId, receiptIds);
    res.json(formatInvoiceResponse(updatedInvoice, oldBalance));
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to mark invoice as paid" });
  }
});

router.delete("/:id", requireRole(UserRole.ADMIN), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid invoice id" });
    }

    const invoice = await prisma.invoice.findUnique({
      where: { id },
      include: { invoiceReceipts: true },
    });

    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    await prisma.$transaction(async (tx) => {
      await tx.invoiceReceipt.deleteMany({ where: { invoiceId: id } });
      await tx.invoice.delete({ where: { id } });
    });

    await logAudit({
      action: "INVOICE_DELETED",
      entityType: "invoice",
      entityId: id,
      description: `Invoice ${invoice.invoiceNo ?? id} deleted by admin`,
      metadata: {
        customerId: invoice.customerId,
        subtotal: invoice.subtotal,
        total: invoice.total,
        receiptCount: invoice.invoiceReceipts.length,
      },
    });

    res.json({ message: "Invoice deleted" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to delete invoice" });
  }
});

export default router;
