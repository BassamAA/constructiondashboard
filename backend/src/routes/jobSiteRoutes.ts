import { Router } from "express";
import prisma from "../prismaClient";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const { customerId } = req.query;
    const where =
      customerId !== undefined
        ? { customerId: Number(customerId) }
        : undefined;

    const jobSites = await prisma.jobSite.findMany({
      where,
      orderBy: [{ customerId: "asc" }, { name: "asc" }],
    });

    res.json(jobSites);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch job sites" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { customerId, name, address, notes } = req.body;
    const parsedCustomerId = Number(customerId);

    if (!customerId || Number.isNaN(parsedCustomerId)) {
      return res.status(400).json({ error: "customerId is required" });
    }

    const normalizedName = typeof name === "string" ? name.trim() : "";
    if (!normalizedName) {
      return res.status(400).json({ error: "name is required" });
    }
    const normalizedAddress =
      typeof address === "string" && address.trim().length > 0 ? address.trim() : null;
    const normalizedNotes =
      typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null;

    const jobSite = await prisma.jobSite.create({
      data: {
        customerId: parsedCustomerId,
        name: normalizedName,
        address: normalizedAddress,
        notes: normalizedNotes,
      },
    });

    res.status(201).json(jobSite);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to create job site" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { name, address, notes } = req.body;

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid job site id" });
    }

    const updateData: Record<string, string | null> = {};

    if (name !== undefined) {
      const normalizedName = typeof name === "string" ? name.trim() : "";
      if (!normalizedName) {
        return res.status(400).json({ error: "name is required" });
      }
      updateData.name = normalizedName;
    }

    if (address !== undefined) {
      const normalizedAddress =
        typeof address === "string" && address.trim().length > 0 ? address.trim() : null;
      updateData.address = normalizedAddress;
    }

    if (notes !== undefined) {
      const normalizedNotes =
        typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null;
      updateData.notes = normalizedNotes;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: "No fields provided to update" });
    }

    const jobSite = await prisma.jobSite.update({
      where: { id },
      data: updateData,
    });

    res.json(jobSite);
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Job site not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to update job site" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid job site id" });
    }

    const receiptCount = await prisma.receipt.count({ where: { jobSiteId: id } });
    if (receiptCount > 0) {
      return res
        .status(400)
        .json({ error: "Cannot delete a job site that has associated receipts" });
    }

    await prisma.jobSite.delete({ where: { id } });
    res.json({ message: "Job site deleted" });
  } catch (err: any) {
    if (err.code === "P2025") {
      return res.status(404).json({ error: "Job site not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to delete job site" });
  }
});

export default router;
