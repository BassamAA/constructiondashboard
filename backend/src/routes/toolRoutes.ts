import { Router } from "express";
import prisma from "../prismaClient";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const tools = await prisma.tool.findMany({ orderBy: { name: "asc" } });
    res.json(tools);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch tools" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { name, quantity, unit, notes } = req.body ?? {};
    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) {
      return res.status(400).json({ error: "Name is required" });
    }
    const qty = quantity === undefined ? 0 : Number(quantity);
    if (Number.isNaN(qty) || qty < 0) {
      return res.status(400).json({ error: "Quantity must be zero or greater" });
    }
    const tool = await prisma.tool.create({
      data: {
        name: trimmedName,
        quantity: qty,
        unit: unit?.trim() || null,
        notes: notes?.trim() || null,
      },
    });
    res.status(201).json(tool);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to create tool" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid tool id" });
    }
    const { name, quantity, unit, notes } = req.body ?? {};
    const data: any = {};
    if (name !== undefined) {
      const trimmedName = typeof name === "string" ? name.trim() : "";
      if (!trimmedName) {
        return res.status(400).json({ error: "Name is required" });
      }
      data.name = trimmedName;
    }
    if (quantity !== undefined) {
      const qty = Number(quantity);
      if (Number.isNaN(qty) || qty < 0) {
        return res.status(400).json({ error: "Quantity must be zero or greater" });
      }
      data.quantity = qty;
    }
    if (unit !== undefined) {
      data.unit = unit?.trim() || null;
    }
    if (notes !== undefined) {
      data.notes = notes?.trim() || null;
    }
    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No fields provided" });
    }
    const tool = await prisma.tool.update({ where: { id }, data });
    res.json(tool);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update tool" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid tool id" });
    }
    await prisma.tool.delete({ where: { id } });
    res.json({ message: "Tool deleted" });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to delete tool" });
  }
});

export default router;
