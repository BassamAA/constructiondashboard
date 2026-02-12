import { Router } from "express";
import { PayFrequency, PaymentType, PayrollRunStatus, PayrollType } from "@prisma/client";
import prisma from "../prismaClient";

const router = Router();

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const payrollInclude = {
  employee: true,
  payment: true,
  stoneProduct: true,
  helperEmployee: true,
};

const payrollRunInclude = {
  entries: {
    include: payrollInclude,
  },
  payment: true,
};

type ManufacturingPieceRateSummary = {
  id: number;
  productId: number;
  rate: number;
  helperRate: number | null;
  isActive: boolean;
};

function computeRunTotals(entries: Array<{ amount: number }>) {
  const totalGross = entries.reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
  return {
    totalGross,
    totalNet: totalGross,
    totalDeductions: 0,
  };
}

async function refreshRunTotals(runId: number) {
  const entries = await prisma.payrollEntry.findMany({
    where: { payrollRunId: runId },
    select: { amount: true },
  });
  const totals = computeRunTotals(entries);
  await prisma.payrollRun.update({
    where: { id: runId },
    data: {
      totalGross: totals.totalGross,
      totalNet: totals.totalNet,
      totalDeductions: totals.totalDeductions,
    },
  });
}

router.get("/runs", async (req, res) => {
  try {
    const statusRaw = req.query.status;
    const frequencyRaw = req.query.frequency;
    const where: any = {};
    if (statusRaw && typeof statusRaw === "string") {
      const normalized = statusRaw.toUpperCase();
      if (!Object.values(PayrollRunStatus).includes(normalized as PayrollRunStatus)) {
        return res.status(400).json({ error: "Invalid status filter" });
      }
      where.status = normalized as PayrollRunStatus;
    }
    if (frequencyRaw && typeof frequencyRaw === "string") {
      const normalized = frequencyRaw.toUpperCase();
      if (!Object.values(PayFrequency).includes(normalized as PayFrequency)) {
        return res.status(400).json({ error: "Invalid frequency filter" });
      }
      where.frequency = normalized as PayFrequency;
    }

    const runs = await prisma.payrollRun.findMany({
      where,
      orderBy: { periodStart: "desc" },
      include: {
        payment: true,
        _count: { select: { entries: true } },
      },
    });

    res.json(runs);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch payroll runs" });
  }
});

router.get("/runs/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid run id" });
    }
    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: payrollRunInclude,
    });
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }
    res.json(run);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch payroll run" });
  }
});

router.post("/runs", async (req, res) => {
  try {
    const { frequency, periodStart, periodEnd, debitAt, notes, entryIds, autoGenerate } = req.body ?? {};
    const normalizedFrequency = typeof frequency === "string" ? frequency.toUpperCase() : null;
    if (!normalizedFrequency || !Object.values(PayFrequency).includes(normalizedFrequency as PayFrequency)) {
      return res.status(400).json({ error: "frequency must be WEEKLY or MONTHLY" });
    }
    const startDate = periodStart ? new Date(periodStart) : null;
    const endDate = periodEnd ? new Date(periodEnd) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) {
      return res.status(400).json({ error: "periodStart is required" });
    }
    if (!endDate || Number.isNaN(endDate.getTime())) {
      return res.status(400).json({ error: "periodEnd is required" });
    }
    const debitDate = debitAt ? new Date(debitAt) : null;
    if (debitAt && (debitDate === null || Number.isNaN(debitDate.getTime()))) {
      return res.status(400).json({ error: "Invalid debitAt value" });
    }

    let parsedEntryIds: number[] | null = null;
    if (Array.isArray(entryIds)) {
      parsedEntryIds = entryIds
        .map((value) => Number(value))
        .filter((value) => !Number.isNaN(value));
    }

    // Build entries: either auto-generate or attach selected existing ones in period
    let entries: Array<{
      employeeId: number;
      periodStart: Date;
      periodEnd: Date;
      type: PayrollType;
      amount: number;
      quantity?: number | null;
      notes?: string | null;
      id?: number;
    }> = [];

    if (autoGenerate) {
      // Salaried employees matching frequency
      const salaryEmployees = await prisma.employee.findMany({
        where: {
          active: true,
          payType: "SALARY",
          salaryFrequency: normalizedFrequency as PayFrequency,
          salaryAmount: { not: null },
        },
        select: { id: true, salaryAmount: true },
      });
      salaryEmployees.forEach((emp) => {
        entries.push({
          employeeId: emp.id,
          periodStart: startDate,
          periodEnd: endDate,
          type: PayrollType.SALARY,
          amount: Number(emp.salaryAmount ?? 0),
          notes: `Auto ${normalizedFrequency.toLowerCase()} salary`,
        });
      });

      // Piecework from production entries (workers/helpers) in the window
      const productionEntries = await prisma.inventoryEntry.findMany({
        where: {
          type: "PRODUCTION",
          entryDate: { gte: startDate, lte: endDate },
          OR: [{ workerEmployeeId: { not: null } }, { helperEmployeeId: { not: null } }],
        },
        select: {
          quantity: true,
          laborAmount: true,
          helperLaborAmount: true,
          workerEmployeeId: true,
          helperEmployeeId: true,
        },
      });
      const workerMap = new Map<number, { quantity: number; amount: number }>();
      productionEntries.forEach((entry) => {
        if (entry.workerEmployeeId) {
          const curr = workerMap.get(entry.workerEmployeeId) ?? { quantity: 0, amount: 0 };
          workerMap.set(entry.workerEmployeeId, {
            quantity: curr.quantity + Number(entry.quantity ?? 0),
            amount: curr.amount + Number(entry.laborAmount ?? 0),
          });
        }
        if (entry.helperEmployeeId) {
          const curr = workerMap.get(entry.helperEmployeeId) ?? { quantity: 0, amount: 0 };
          workerMap.set(entry.helperEmployeeId, {
            quantity: curr.quantity + Number(entry.quantity ?? 0),
            amount: curr.amount + Number(entry.helperLaborAmount ?? 0),
          });
        }
      });
      workerMap.forEach((summary, employeeId) => {
        const amount = summary.amount;
        if (amount <= 0) return;
        entries.push({
          employeeId,
          periodStart: startDate,
          periodEnd: endDate,
          type: PayrollType.PIECEWORK,
          amount,
          quantity: summary.quantity,
          notes: `Auto piecework ${normalizedFrequency.toLowerCase()}`,
        });
      });
    } else {
      const existingEntries = await prisma.payrollEntry.findMany({
        where: {
          periodStart: { gte: startDate },
          periodEnd: { lte: endDate },
          payrollRunId: null,
          ...(parsedEntryIds ? { id: { in: parsedEntryIds } } : {}),
        },
      });
      entries = existingEntries.map((e) => ({ ...e }));
    }

    if (entries.length === 0) {
      return res.status(400).json({ error: "No payroll entries found for the selected period" });
    }

    const totals = computeRunTotals(entries);

    const run = await prisma.$transaction(async (tx) => {
      const created = await tx.payrollRun.create({
        data: {
          frequency: normalizedFrequency as PayFrequency,
          status: PayrollRunStatus.DRAFT,
          periodStart: startDate,
          periodEnd: endDate,
          debitAt: debitDate,
          notes: typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : null,
          totalGross: totals.totalGross,
          totalNet: totals.totalNet,
          totalDeductions: totals.totalDeductions,
          entries:
            autoGenerate && !parsedEntryIds
              ? {
                  create: entries.map((entry) => ({
                    employeeId: entry.employeeId,
                    periodStart: entry.periodStart,
                    periodEnd: entry.periodEnd,
                    type: entry.type,
                    amount: entry.amount,
                    quantity: entry.quantity ?? null,
                    notes: entry.notes ?? null,
                  })),
                }
              : undefined,
        },
      });

      if (!autoGenerate || parsedEntryIds) {
        await tx.payrollEntry.updateMany({
          where: { id: { in: entries.map((entry) => entry.id!).filter(Boolean) } },
          data: { payrollRunId: created.id },
        });
      }

      return created;
    });

    const hydrated = await prisma.payrollRun.findUnique({
      where: { id: run.id },
      include: payrollRunInclude,
    });

    res.status(201).json(hydrated);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to create payroll run" });
  }
});

router.post("/runs/:id/finalize", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid run id" });
    }
    const { debitAt, notes } = req.body ?? {};
    const debitDate = debitAt ? new Date(debitAt) : null;
    if (debitAt && (debitDate === null || Number.isNaN(debitDate.getTime()))) {
      return res.status(400).json({ error: "Invalid debitAt value" });
    }

    const run = await prisma.payrollRun.update({
      where: { id },
      data: {
        status: PayrollRunStatus.FINALIZED,
        debitAt: debitDate ?? undefined,
        notes: typeof notes === "string" && notes.trim().length > 0 ? notes.trim() : undefined,
      },
      include: payrollRunInclude,
    });

    res.json(run);
  } catch (err: any) {
    if (err instanceof Error && err.message.includes("Record to update not found")) {
      return res.status(404).json({ error: "Run not found" });
    }
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to finalize payroll run" });
  }
});

router.post("/runs/:id/debit", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid run id" });
    }
    const run = await prisma.payrollRun.findUnique({
      where: { id },
      include: {
        entries: true,
        payment: true,
      },
    });
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }
    if (run.status !== PayrollRunStatus.FINALIZED && run.status !== PayrollRunStatus.DRAFT) {
      return res.status(400).json({ error: "Only draft or finalized runs can be debited" });
    }
    if (run.payment) {
      return res.status(400).json({ error: "Run already debited" });
    }
    const totals = computeRunTotals(run.entries);
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          amount: totals.totalNet,
          date: now,
          type: PaymentType.PAYROLL_RUN,
          description: `Payroll run ${run.id} (${run.frequency.toLowerCase()})`,
          payrollRunId: run.id,
        },
      });

      return tx.payrollRun.update({
        where: { id: run.id },
        data: {
          status: PayrollRunStatus.PAID,
          paidAt: now,
          totalGross: totals.totalGross,
          totalNet: totals.totalNet,
          totalDeductions: totals.totalDeductions,
        },
        include: payrollRunInclude,
      });
    });

    res.json(updated);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to debit payroll run" });
  }
});

router.get("/paginated", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(Number(req.query.limit) || DEFAULT_PAGE_SIZE, 1),
      MAX_PAGE_SIZE,
    );
    const cursorRaw = req.query.cursor;
    const cursor = cursorRaw !== undefined ? Number(cursorRaw) : null;
    if (cursor !== null && Number.isNaN(cursor)) {
      return res.status(400).json({ error: "Invalid cursor" });
    }

    const entries = await prisma.payrollEntry.findMany({
      orderBy: { id: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: payrollInclude,
    });

    const hasNext = entries.length > limit;
    if (hasNext) {
      entries.pop();
    }
    const nextCursor = hasNext ? entries[entries.length - 1]?.id ?? null : null;

    res.json({ items: entries, nextCursor });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch payroll entries" });
  }
});

router.get("/", async (_req, res) => {
  try {
    const payroll = await prisma.payrollEntry.findMany({
      include: payrollInclude,
      orderBy: { createdAt: "desc" },
    });
    res.json(payroll);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to fetch payroll entries" });
  }
});

router.post("/", async (req, res) => {
  try {
    const {
      employeeId,
      periodStart,
      periodEnd,
      type,
      quantity,
      amount,
      notes,
      createPayment = false,
      paymentDate,
      paymentDescription,
      paymentReference,
      paymentCategory,
      stoneProductId,
      helperEmployeeId,
      payrollRunId,
    } = req.body ?? {};

    const parsedEmployeeId = Number(employeeId);
    if (!employeeId || Number.isNaN(parsedEmployeeId)) {
      return res.status(400).json({ error: "employeeId is required" });
    }

    const periodStartDate =
      typeof periodStart === "string" && periodStart.trim().length > 0
        ? new Date(periodStart)
        : new Date();
    if (Number.isNaN(periodStartDate.getTime())) {
      return res.status(400).json({ error: "Invalid periodStart value" });
    }

    const periodEndDate =
      typeof periodEnd === "string" && periodEnd.trim().length > 0
        ? new Date(periodEnd)
        : periodStartDate;
    if (Number.isNaN(periodEndDate.getTime())) {
      return res.status(400).json({ error: "Invalid periodEnd value" });
    }

    const employee = await prisma.employee.findUnique({
      where: { id: parsedEmployeeId },
      select: {
        id: true,
        name: true,
        payType: true,
        salaryAmount: true,
      },
    });

    if (!employee) {
      return res.status(400).json({ error: "Employee not found" });
    }
    const employeePieceRates = await fetchManufacturingPieceRates(parsedEmployeeId);

    let parsedPayrollRunId: number | null = null;
    if (payrollRunId !== undefined && payrollRunId !== null && `${payrollRunId}`.trim() !== "") {
      parsedPayrollRunId = Number(payrollRunId);
      if (Number.isNaN(parsedPayrollRunId)) {
        return res.status(400).json({ error: "payrollRunId must be a valid number" });
      }
      const run = await prisma.payrollRun.findUnique({
        where: { id: parsedPayrollRunId },
        select: { id: true, status: true },
      });
      if (!run) {
        return res.status(400).json({ error: "Payroll run not found" });
      }
      if (run.status === PayrollRunStatus.PAID || run.status === PayrollRunStatus.CANCELLED) {
        return res.status(400).json({ error: "Cannot attach entries to a paid or cancelled run" });
      }
    }

    const normalizedType = (type ?? employee.payType).toUpperCase();
    if (!Object.values(PayrollType).includes(normalizedType as PayrollType)) {
      return res.status(400).json({ error: "Invalid payroll type" });
    }
    if (normalizedType !== employee.payType) {
      return res
        .status(400)
        .json({ error: "Payroll type must match the employee's pay type" });
    }

    let parsedStoneProductId: number | null = null;
    let stoneProduct: {
      id: number;
      pieceworkRate: number | null;
      helperPieceworkRate: number | null;
      isManufactured: boolean;
      name: string;
    } | null = null;
    if (stoneProductId !== undefined && stoneProductId !== null && `${stoneProductId}`.trim() !== "") {
      parsedStoneProductId = Number(stoneProductId);
      if (Number.isNaN(parsedStoneProductId)) {
        return res.status(400).json({ error: "stoneProductId must be a valid number" });
      }
      const fetched = await prisma.product.findUnique({
        where: { id: parsedStoneProductId },
        select: {
          id: true,
          pieceworkRate: true,
          helperPieceworkRate: true,
          isManufactured: true,
          name: true,
        },
      });
      if (!fetched) {
        return res.status(400).json({ error: "Stone product not found" });
      }
      if (!fetched.isManufactured) {
        return res.status(400).json({ error: "Stone product must be a manufactured product" });
      }
      stoneProduct = fetched;
    }

    let helperEmployee: { id: number; name: string } | null = null;
    let helperEmployeePieceRates: ManufacturingPieceRateSummary[] = [];
    if (helperEmployeeId !== undefined && helperEmployeeId !== null && `${helperEmployeeId}`.trim() !== "") {
      const parsedHelperId = Number(helperEmployeeId);
      if (Number.isNaN(parsedHelperId)) {
        return res.status(400).json({ error: "helperEmployeeId must be a valid number" });
      }
      if (parsedHelperId === parsedEmployeeId) {
        return res.status(400).json({ error: "Helper cannot be the same as the primary employee" });
      }
      const fetchedHelper = await prisma.employee.findUnique({
        where: { id: parsedHelperId },
        select: {
          id: true,
          name: true,
        },
      });
      if (!fetchedHelper) {
        return res.status(400).json({ error: "Helper employee not found" });
      }
      helperEmployee = fetchedHelper;
      helperEmployeePieceRates = await fetchManufacturingPieceRates(parsedHelperId);
    }

    let computedAmount: number | null = null;
    let computedQuantity: number | null = null;
    let helperEmployeeUnitRate: number | null = null;

    if (normalizedType === PayrollType.SALARY) {
      if (amount !== undefined && amount !== null) {
        const parsedAmount = Number(amount);
        if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
          return res.status(400).json({ error: "Amount must be a positive number" });
        }
        computedAmount = parsedAmount;
      } else if (employee.salaryAmount) {
        computedAmount = employee.salaryAmount;
      } else {
        return res
          .status(400)
          .json({ error: "Provide amount or set a salary amount for this employee" });
      }
    } else {
      const parsedQuantity =
        quantity !== undefined && quantity !== null ? Number(quantity) : null;
      if (!parsedQuantity || Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
        return res.status(400).json({ error: "quantity is required for piecework payroll" });
      }
      if (helperEmployee) {
        if (!stoneProduct) {
          return res
            .status(400)
            .json({ error: "Select the stone product so helper payouts can be calculated." });
        }
        const helperMatch = helperEmployeePieceRates.find(
          (rate) => rate.productId === stoneProduct.id && rate.isActive,
        );
        helperEmployeeUnitRate =
          helperMatch?.helperRate ??
          helperMatch?.rate ??
          null;
        if (
          helperEmployeeUnitRate === null &&
          (stoneProduct.helperPieceworkRate === null ||
            stoneProduct.helperPieceworkRate === undefined ||
            stoneProduct.helperPieceworkRate <= 0)
        ) {
          return res.status(400).json({
            error: `Configure a helper rate for ${stoneProduct.name} in Products or on the selected employee before logging payroll.`,
          });
        }
      }

      let baseRate: number | null = null;
      if (stoneProduct) {
        const matchingRate = employeePieceRates.find(
          (rate) => rate.productId === stoneProduct.id && rate.isActive,
        );
        baseRate = matchingRate?.rate ?? stoneProduct.pieceworkRate ?? null;
      }
      if (!baseRate) {
        return res
          .status(400)
          .json({ error: "Set a piece rate on the employee or the selected stone product" });
      }
      computedQuantity = parsedQuantity;

      const parsedAmountOverride =
        amount !== undefined && amount !== null && `${amount}`.trim() !== ""
          ? Number(amount)
          : null;
      if (parsedAmountOverride !== null) {
        if (Number.isNaN(parsedAmountOverride) || parsedAmountOverride <= 0) {
          return res.status(400).json({ error: "Amount must be a positive number" });
        }
        computedAmount = parsedAmountOverride;
      } else {
        computedAmount = parsedQuantity * baseRate;
      }
    }

    if (computedAmount === null || Number.isNaN(computedAmount) || computedAmount <= 0) {
      return res.status(400).json({ error: "Unable to determine payroll amount" });
    }
    const confirmedAmount = Number(computedAmount);

    const paymentDateValue =
      createPayment && paymentDate
        ? (() => {
            const parsedDate = new Date(paymentDate);
            return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
          })()
        : createPayment
          ? periodEndDate
          : undefined;
    if (createPayment && !paymentDateValue) {
      return res.status(400).json({ error: "Invalid paymentDate value" });
    }

    const paymentDescriptionValue =
      createPayment && typeof paymentDescription === "string" && paymentDescription.trim().length > 0
        ? paymentDescription.trim()
        : null;

    const paymentReferenceValue =
      createPayment && typeof paymentReference === "string" && paymentReference.trim().length > 0
        ? paymentReference.trim()
        : null;

    const paymentCategoryValue =
      createPayment && typeof paymentCategory === "string" && paymentCategory.trim().length > 0
        ? paymentCategory.trim()
        : null;

    const payrollEntryId = await prisma.$transaction(async (tx) => {
      const created = await tx.payrollEntry.create({
        data: {
          employeeId: parsedEmployeeId,
          periodStart: periodStartDate,
          periodEnd: periodEndDate,
          type: normalizedType as PayrollType,
          quantity: computedQuantity,
          amount: confirmedAmount,
          notes: notes?.trim() || null,
          stoneProductId: parsedStoneProductId ?? undefined,
          helperEmployeeId: helperEmployee?.id ?? null,
          payrollRunId: parsedPayrollRunId ?? undefined,
        },
      });

      if (createPayment) {
        await tx.payment.create({
          data: {
            date: paymentDateValue ?? periodEndDate,
            amount: confirmedAmount,
            type:
              normalizedType === PayrollType.SALARY
                ? PaymentType.PAYROLL_SALARY
                : PaymentType.PAYROLL_PIECEWORK,
            description: paymentDescriptionValue ?? `Payroll for ${employee.name}`,
            reference: paymentReferenceValue,
            category: paymentCategoryValue,
            payrollEntry: { connect: { id: created.id } },
          },
        });
      }

      if (
        helperEmployee &&
        normalizedType === PayrollType.PIECEWORK &&
        stoneProduct &&
        computedQuantity !== null &&
        computedQuantity !== undefined
      ) {
        const helperUnitRate =
          helperEmployeeUnitRate ??
          stoneProduct.helperPieceworkRate ??
          null;
        if (!helperUnitRate || helperUnitRate <= 0) {
          throw new Error("Helper rate is not configured");
        }
        const helperAmount = helperUnitRate * computedQuantity;
        const helperEntry = await tx.payrollEntry.create({
          data: {
            employeeId: helperEmployee.id,
            periodStart: periodStartDate,
            periodEnd: periodEndDate,
            type: PayrollType.PIECEWORK,
            quantity: computedQuantity,
            amount: helperAmount,
            notes: `Helper payout for ${employee.name}${
              stoneProduct.name ? ` – ${stoneProduct.name}` : ""
            }`,
            stoneProductId: stoneProduct.id,
            helperEmployeeId: null,
          },
        });

        if (createPayment) {
          await tx.payment.create({
            data: {
              date: paymentDateValue ?? periodEndDate,
              amount: helperAmount,
              type: PaymentType.PAYROLL_PIECEWORK,
              description: paymentDescriptionValue ?? `Helper payout (${stoneProduct.name})`,
              reference: paymentReferenceValue,
              category: paymentCategoryValue,
              payrollEntry: { connect: { id: helperEntry.id } },
            },
          });
        }
      }

      return created.id;
    });

    if (parsedPayrollRunId) {
      await refreshRunTotals(parsedPayrollRunId);
    }

    // refresh with includes to ensure consistent shape
    const fresh = await prisma.payrollEntry.findUnique({
      where: { id: payrollEntryId },
      include: {
        employee: true,
        payment: true,
        stoneProduct: true,
        helperEmployee: true,
      },
    });

    if (!fresh) {
      return res.status(500).json({ error: "Failed to load payroll entry" });
    }

    res.status(201).json(fresh);
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message ?? "Failed to create payroll entry" });
  }
});

async function fetchManufacturingPieceRates(
  employeeId: number,
): Promise<ManufacturingPieceRateSummary[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: number;
      productId: number;
      rate: number;
      helperRate: number | null;
      isActive: boolean;
    }>
  >`
    SELECT "id",
           "productId",
           "rate",
           "helperRate",
           "isActive"
    FROM "ManufacturingPieceRate"
    WHERE "employeeId" = ${employeeId}
  `;
  return rows.map((row) => ({
    id: row.id,
    productId: row.productId,
    rate: Number(row.rate),
    helperRate: row.helperRate === null ? null : Number(row.helperRate),
    isActive: row.isActive,
  }));
}

export default router;
