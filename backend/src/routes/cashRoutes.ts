import { Router } from "express";
import {
  CashCustodyType,
  CashEntryType,
  EmployeeRole,
  InventoryEntryType,
  PaymentType,
  PayrollType,
} from "@prisma/client";
import prisma from "../prismaClient";
import { logAudit } from "../utils/auditLogger";

const router = Router();
const allowedCustodyNames = ["ahmad kadoura", "ahmad yasin", "bassam"];
const allowedCustodyNameSet = new Set(allowedCustodyNames);
const ownerName = "bassam";

function normalizeName(name?: string | null) {
  return name?.trim().toLowerCase() ?? "";
}

function isAllowedEmployeeName(name?: string | null) {
  return allowedCustodyNameSet.has(normalizeName(name));
}

function isOwnerEmployee(name?: string | null) {
  return normalizeName(name) === ownerName;
}

async function ensureCustodyEmployees() {
  const existing = await prisma.employee.findMany({
    where: {
      OR: allowedCustodyNames.map((name) => ({
        name: {
          equals: name,
          mode: "insensitive",
        },
      })),
    },
  });
  const existingMap = new Map<string, (typeof existing)[number]>();
  existing.forEach((employee) => existingMap.set((employee.name ?? "").trim().toLowerCase(), employee));

  for (const name of allowedCustodyNames) {
    if (!existingMap.has(name)) {
      const created = await prisma.employee.create({
        data: {
          name: name
            .split(" ")
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
            .join(" "),
          role: EmployeeRole.MANUFACTURING,
          payType: PayrollType.SALARY,
          salaryAmount: 0,
          salaryFrequency: "MONTHLY",
          active: true,
          notes: "Auto-created for cash custody tracking",
        },
      });
      existingMap.set(name, created);
    }
  }

  return existingMap;
}

router.get("/summary", async (_req, res) => {
  try {
    const [
      receiptsPaidAgg,
      paymentsOutAgg,
      inventoryPaidAgg,
      receivablesAgg,
      payablesAgg,
    ] = await Promise.all([
      prisma.receipt.aggregate({
        _sum: { total: true },
        where: { isPaid: true },
      }),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: {
          type: {
            in: [
              PaymentType.GENERAL_EXPENSE,
              PaymentType.SUPPLIER,
              PaymentType.PAYROLL_SALARY,
              PaymentType.PAYROLL_PIECEWORK,
              PaymentType.DEBRIS_REMOVAL,
              PaymentType.OWNER_DRAW,
            ],
          },
        },
      }),
      prisma.inventoryEntry.aggregate({
        _sum: { totalCost: true },
        where: {
          type: InventoryEntryType.PURCHASE,
          isPaid: true,
        },
      }),
      prisma.receipt.aggregate({
        _sum: { total: true },
        where: { isPaid: false },
      }),
      prisma.inventoryEntry.aggregate({
        _sum: { totalCost: true },
        where: {
          type: InventoryEntryType.PURCHASE,
          isPaid: false,
        },
      }),
    ]);

    const paidIn = receiptsPaidAgg._sum.total ?? 0;
    const paidOut = (paymentsOutAgg._sum.amount ?? 0) + (inventoryPaidAgg._sum.totalCost ?? 0);

    res.json({
      cashOnHand: paidIn - paidOut,
      paidIn,
      paidOut,
      receivables: receivablesAgg._sum.total ?? 0,
      payables: payablesAgg._sum.totalCost ?? 0,
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to load cash summary" });
  }
});

router.get("/entries", async (_req, res) => {
  try {
    const entries = await prisma.cashEntry.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        createdByUser: { select: { id: true, email: true, name: true } },
      },
    });
    res.json({ entries });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to load cash entries" });
  }
});

router.post("/entries", async (req, res) => {
  try {
    const { amount, type, description } = req.body ?? {};
    if (typeof amount !== "number" || Number.isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }
    if (!type || !Object.values(CashEntryType).includes(type)) {
      return res.status(400).json({ error: "Invalid entry type" });
    }

    let signedAmount = amount;
    if (type === CashEntryType.WITHDRAW || type === CashEntryType.OWNER_DRAW) {
      signedAmount = -Math.abs(amount);
    }

    const entry = await prisma.cashEntry.create({
      data: {
        type,
        amount: signedAmount,
        description: typeof description === "string" ? description.trim() : null,
        createdByUserId: req.user?.id ?? null,
      },
    });

    if (type === CashEntryType.OWNER_DRAW) {
      await prisma.payment.create({
        data: {
          amount,
          type: PaymentType.OWNER_DRAW,
          description: description?.trim() || "Owner draw",
          category: "Owner Draw",
          reference: `cash-entry-${entry.id}`,
        },
      });
    }

    res.status(201).json({ entry });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to record cash entry" });
  }
});

router.get("/custody", async (_req, res) => {
  try {
    const employeesMap = await ensureCustodyEmployees();
    const custodyEmployees = allowedCustodyNames
      .map((name) => employeesMap.get(name))
      .filter((employee): employee is NonNullable<typeof employee> => Boolean(employee))
      .map((employee) => ({
        id: employee.id,
        name: employee.name ?? "",
      }));
    const [latestEntries, aggregateEntries] = await Promise.all([
      prisma.cashCustodyEntry.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          fromEmployee: { select: { id: true, name: true } },
          toEmployee: { select: { id: true, name: true } },
          createdByUser: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.cashCustodyEntry.findMany({
        select: {
          type: true,
          amount: true,
          fromEmployeeId: true,
          toEmployeeId: true,
        },
      }),
    ]);

    const outstandingMap = new Map<number, number>();
    aggregateEntries.forEach((entry) => {
      const amountValue = Number(entry.amount);
      outstandingMap.set(
        entry.fromEmployeeId,
        (outstandingMap.get(entry.fromEmployeeId) ?? 0) - amountValue,
      );
      outstandingMap.set(
        entry.toEmployeeId,
        (outstandingMap.get(entry.toEmployeeId) ?? 0) + amountValue,
      );
    });

    const holderIds = [...outstandingMap.entries()]
      .filter(([, amount]) => Math.abs(amount) > 1e-6)
      .map(([employeeId]) => employeeId);

    const holders = holderIds.length
      ? await prisma.employee.findMany({
          where: { id: { in: holderIds } },
          select: { id: true, name: true },
        })
      : [];

    const filteredHolders = holders.filter((employee) => isAllowedEmployeeName(employee.name));

    const outstanding = filteredHolders
      .map((employee) => ({
        employee,
        amount: outstandingMap.get(employee.id) ?? 0,
      }))
      .filter((item) => Math.abs(item.amount) > 1e-6)
      .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));

    const filteredEntries = latestEntries.filter(
      (entry) =>
        isAllowedEmployeeName(entry.fromEmployee.name) ||
        isAllowedEmployeeName(entry.toEmployee.name),
    );

    res.json({ entries: filteredEntries, outstanding, employees: custodyEmployees });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to load cash custody" });
  }
});

router.post("/custody", async (req, res) => {
  try {
    const employeesMap = await ensureCustodyEmployees();

    const { amount, fromEmployeeId, toEmployeeId, description } = req.body ?? {};

    const parsedAmount = Number(amount);
    if (!amount || Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ error: "Amount must be a positive number" });
    }

    const fromId = Number(fromEmployeeId);
    const toId = Number(toEmployeeId);
    if (Number.isNaN(fromId) || Number.isNaN(toId)) {
      return res.status(400).json({ error: "Both employees must be selected" });
    }
    if (fromId === toId) {
      return res.status(400).json({ error: "From and to employees must be different" });
    }

    const fromEmployee = Array.from(employeesMap.values()).find((employee) => employee.id === fromId);
    const toEmployee = Array.from(employeesMap.values()).find((employee) => employee.id === toId);

    if (!fromEmployee || !toEmployee) {
      return res
        .status(400)
        .json({
          error: "Only Ahmad Kadoura, Ahmad Yasin, and Bassam can be selected for custody logs",
        });
    }

    const custodyEntry = await prisma.cashCustodyEntry.create({
      data: {
        amount: parsedAmount,
        type: CashCustodyType.HANDOFF,
        fromEmployeeId: fromId,
        toEmployeeId: toId,
        description:
          typeof description === "string" && description.trim().length > 0
            ? description.trim()
            : null,
        createdByUserId: req.user?.id ?? null,
      },
      include: {
        fromEmployee: { select: { id: true, name: true } },
        toEmployee: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true, email: true } },
      },
    });

    await logAudit({
      action: "CASH_CUSTODY_RECORDED",
      entityType: "cashCustody",
      entityId: custodyEntry.id,
      description: `Cash custody handoff of ${parsedAmount.toFixed(2)} from ${fromEmployee.name} to ${toEmployee.name}`,
      metadata: {
        type: CashCustodyType.HANDOFF,
        amount: parsedAmount,
        fromEmployeeId: fromId,
        toEmployeeId: toId,
      },
    });

    if (isOwnerEmployee(custodyEntry.toEmployee.name)) {
      await prisma.payment.create({
        data: {
          amount: parsedAmount,
          type: PaymentType.OWNER_DRAW,
          description:
            description?.trim() ||
            `Owner draw via custody #${custodyEntry.id} to ${custodyEntry.toEmployee.name}`,
          category: "Owner Draw",
          reference: `custody-${custodyEntry.id}`,
        },
      });
    }

    if (isOwnerEmployee(custodyEntry.fromEmployee.name)) {
      await prisma.cashEntry.create({
        data: {
          type: CashEntryType.DEPOSIT,
          amount: Math.abs(parsedAmount),
          description:
            description?.trim() ||
            `Cash returned by ${custodyEntry.fromEmployee.name} (custody #${custodyEntry.id})`,
          createdByUserId: req.user?.id ?? null,
        },
      });
    }

    res.status(201).json(custodyEntry);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to record cash custody entry" });
  }
});

export default router;
