import { Router } from "express";
import prisma from "../prismaClient";
import { logAudit } from "../utils/auditLogger";

const router = Router();

const receiptInclude = {
  items: {
    include: {
      product: true,
    },
  },
  customer: true,
  driver: true,
  truck: true,
  jobSite: true,
};

router.get("/receipts/:id/print", async (req, res) => {
  const receiptId = Number(req.params.id);
  if (Number.isNaN(receiptId)) {
    return res.status(400).json({ error: "Invalid receipt id" });
  }

  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    include: receiptInclude,
  });

  if (!receipt) {
    return res.status(404).json({ error: "Receipt not found" });
  }

  return res.json({ receipt });
});

router.post("/receipts/:id/print-log", async (req, res) => {
  const receiptId = Number(req.params.id);
  if (Number.isNaN(receiptId)) {
    return res.status(400).json({ error: "Invalid receipt id" });
  }

  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true,
      receiptNo: true,
      customerId: true,
      walkInName: true,
      customer: { select: { name: true } },
    },
  });

  if (!receipt) {
    return res.status(404).json({ error: "Receipt not found" });
  }

  await logAudit({
    action: "RECEIPT_PRINTED",
    entityType: "receipt",
    entityId: receipt.id,
    description: `Receipt ${receipt.receiptNo ?? receipt.id} printed`,
    user: req.user?.email ?? req.user?.name ?? null,
    metadata: {
      customerId: receipt.customerId ?? null,
      customerName: receipt.customer?.name ?? receipt.walkInName ?? null,
    },
  });

  return res.json({ ok: true });
});

router.get("/receipts/by-number/:receiptNo", async (req, res) => {
  const { receiptNo } = req.params;
  if (!receiptNo || !receiptNo.trim()) {
    return res.status(400).json({ error: "receiptNo is required" });
  }

  const receipt = await prisma.receipt.findFirst({
    where: { receiptNo: receiptNo.trim() },
    include: receiptInclude,
    orderBy: { id: "desc" },
  });

  if (!receipt) {
    return res.status(404).json({ error: "Receipt not found" });
  }

  return res.json({ receipt });
});

export default router;
