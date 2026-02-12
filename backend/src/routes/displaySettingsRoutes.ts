import { Router } from "express";
import prisma from "../prismaClient";

const router = Router();
const SETTINGS_ID = 1;

router.get("/", async (_req, res) => {
  try {
    const settings =
      (await prisma.displaySettings.findUnique({ where: { id: SETTINGS_ID } })) ??
      (await prisma.displaySettings.create({ data: { id: SETTINGS_ID } }));
    res.json(settings);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to load display settings" });
  }
});

router.put("/", async (req, res) => {
  try {
    const {
      displayCash,
      displayReceivables,
      displayPayables,
      includeReceipts,
      includeSupplierPurchases,
      includeManufacturing,
      includePayroll,
      includeDebris,
      includeGeneralExpenses,
      includeInventoryValue,
    } = req.body ?? {};
    const data: any = {};
    if (displayCash !== undefined) data.displayCash = Boolean(displayCash);
    if (displayReceivables !== undefined) data.displayReceivables = Boolean(displayReceivables);
    if (displayPayables !== undefined) data.displayPayables = Boolean(displayPayables);
    if (includeReceipts !== undefined) data.includeReceipts = Boolean(includeReceipts);
    if (includeSupplierPurchases !== undefined) data.includeSupplierPurchases = Boolean(includeSupplierPurchases);
    if (includeManufacturing !== undefined) data.includeManufacturing = Boolean(includeManufacturing);
    if (includePayroll !== undefined) data.includePayroll = Boolean(includePayroll);
    if (includeDebris !== undefined) data.includeDebris = Boolean(includeDebris);
    if (includeGeneralExpenses !== undefined) data.includeGeneralExpenses = Boolean(includeGeneralExpenses);
    if (includeInventoryValue !== undefined) data.includeInventoryValue = Boolean(includeInventoryValue);

    const settings = await prisma.displaySettings.upsert({
      where: { id: SETTINGS_ID },
      update: data,
      create: { id: SETTINGS_ID, ...data },
    });
    res.json(settings);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update display settings" });
  }
});

export default router;
