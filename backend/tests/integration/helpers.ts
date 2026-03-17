import request from "supertest";
import { UserRole, type ReceiptType, type InventoryEntryType, type PaymentType, type PayrollType, type PayFrequency } from "@prisma/client";
import prisma from "../../src/prismaClient";
import { app } from "../../src/app";
import { createSession } from "../../src/utils/sessionService";
import { hashPassword } from "../../src/utils/password";

export const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);

export const describeIfDatabase = hasDatabaseUrl ? describe : describe.skip;

export async function resetDatabase() {
  if (!hasDatabaseUrl) return;

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const tableList = tables
    .map((row) => `"public"."${row.tablename.replace(/"/g, '""')}"`)
    .join(", ");

  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
}

export function useIntegrationDatabase() {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    if (hasDatabaseUrl) {
      await prisma.$disconnect();
    }
  });
}

type TestUserOptions = {
  role?: UserRole;
  email?: string;
  name?: string;
  password?: string;
  permissions?: Record<string, boolean> | null;
};

export async function createTestUser(options: TestUserOptions = {}) {
  const email = options.email ?? `${(options.role ?? UserRole.ADMIN).toLowerCase()}-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const password = options.password ?? "Password123!";
  const user = await prisma.user.create({
    data: {
      email,
      name: options.name ?? email.split("@")[0],
      role: options.role ?? UserRole.ADMIN,
      passwordHash: await hashPassword(password),
      permissions: options.permissions ?? undefined,
    },
  });

  return { user, password };
}

export async function createAuthenticatedRequest(options: TestUserOptions = {}) {
  const { user } = await createTestUser(options);
  const { rawToken } = await createSession(user.id);
  return {
    user,
    cookie: `sid=${rawToken}`,
    request: request(app),
  };
}

export async function createCustomer(data: Partial<{ name: string; receiptType: ReceiptType; phone: string; email: string }> = {}) {
  return prisma.customer.create({
    data: {
      name: data.name ?? "Acme Construction",
      receiptType: data.receiptType ?? "NORMAL",
      phone: data.phone ?? null,
      email: data.email ?? null,
    },
  });
}

export async function createSupplier(data: Partial<{ name: string; contact: string }> = {}) {
  return prisma.supplier.create({
    data: {
      name: data.name ?? "Stone Supply",
      contact: data.contact ?? null,
    },
  });
}

export async function createProduct(
  data: Partial<{
    name: string;
    unit: string;
    stockQty: number;
    isManufactured: boolean;
    pieceworkRate: number;
    helperPieceworkRate: number;
    productionPowderProductId: number | null;
    productionPowderQuantity: number | null;
    productionCementProductId: number | null;
    productionCementQuantity: number | null;
  }> = {},
) {
  return prisma.product.create({
    data: {
      name: data.name ?? `Product ${Math.random().toString(16).slice(2, 7)}`,
      unit: data.unit ?? "ton",
      stockQty: data.stockQty ?? 0,
      isManufactured: data.isManufactured ?? false,
      pieceworkRate: data.pieceworkRate ?? null,
      helperPieceworkRate: data.helperPieceworkRate ?? null,
      productionPowderProductId: data.productionPowderProductId ?? null,
      productionPowderQuantity: data.productionPowderQuantity ?? null,
      productionCementProductId: data.productionCementProductId ?? null,
      productionCementQuantity: data.productionCementQuantity ?? null,
    },
  });
}

export async function createJobSite(customerId: number, name = "Main Site") {
  return prisma.jobSite.create({
    data: {
      customerId,
      name,
    },
  });
}

export async function createReceipt(options: {
  customerId?: number | null;
  jobSiteId?: number | null;
  type?: ReceiptType;
  total?: number;
  amountPaid?: number;
  isPaid?: boolean;
  receiptNo?: string;
  productId?: number;
}) {
  const productId = options.productId ?? (await createProduct({ name: "Receipt Product" })).id;
  const total = options.total ?? 100;
  const amountPaid = options.amountPaid ?? 0;
  const receiptNo = options.receiptNo ?? `R-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

  return prisma.receipt.create({
    data: {
      receiptNo,
      type: options.type ?? "NORMAL",
      customerId: options.customerId ?? null,
      jobSiteId: options.jobSiteId ?? null,
      total,
      amountPaid,
      isPaid: options.isPaid ?? amountPaid >= total,
      items: {
        create: [
          {
            productId,
            quantity: 1,
            unitPrice: total,
            subtotal: total,
          },
        ],
      },
    },
    include: {
      items: true,
    },
  });
}

export async function createInventoryPurchase(options: {
  supplierId: number;
  productId: number;
  inventoryNo?: string;
  quantity?: number;
  unitCost?: number;
  isPaid?: boolean;
  amountPaid?: number;
  entryDate?: Date;
}) {
  const quantity = options.quantity ?? 5;
  const unitCost = options.unitCost ?? 20;
  const totalCost = quantity * unitCost;
  return prisma.inventoryEntry.create({
    data: {
      inventoryNo: options.inventoryNo ?? `P-${Date.now()}-${Math.random().toString(16).slice(2, 5)}`,
      type: "PURCHASE",
      supplierId: options.supplierId,
      productId: options.productId,
      quantity,
      unitCost,
      totalCost,
      amountPaid: options.amountPaid ?? 0,
      isPaid: options.isPaid ?? false,
      entryDate: options.entryDate ?? new Date(),
    },
  });
}

export async function createEmployee(options: Partial<{
  name: string;
  role: string;
  payType: PayrollType;
  salaryAmount: number | null;
  salaryFrequency: PayFrequency | null;
}> = {}) {
  return prisma.employee.create({
    data: {
      name: options.name ?? `Employee ${Math.random().toString(16).slice(2, 7)}`,
      role: (options.role ?? "MANUFACTURING") as any,
      payType: options.payType ?? "SALARY",
      salaryAmount: options.salaryAmount ?? 1200,
      salaryFrequency: options.salaryFrequency ?? "WEEKLY",
    },
  });
}

export async function createPayrollEntry(options: {
  employeeId: number;
  type?: PayrollType;
  amount?: number;
  quantity?: number | null;
  payrollRunId?: number | null;
  periodStart?: Date;
  periodEnd?: Date;
}) {
  const periodStart = options.periodStart ?? new Date();
  const periodEnd = options.periodEnd ?? periodStart;
  return prisma.payrollEntry.create({
    data: {
      employeeId: options.employeeId,
      periodStart,
      periodEnd,
      type: options.type ?? "SALARY",
      amount: options.amount ?? 250,
      quantity: options.quantity ?? null,
      payrollRunId: options.payrollRunId ?? null,
    },
  });
}

export async function createPaymentRecord(options: {
  amount: number;
  type: PaymentType;
  customerId?: number | null;
  supplierId?: number | null;
  receiptId?: number | null;
  payrollRunId?: number | null;
}) {
  return prisma.payment.create({
    data: {
      amount: options.amount,
      type: options.type,
      customerId: options.customerId ?? null,
      supplierId: options.supplierId ?? null,
      receiptId: options.receiptId ?? null,
      payrollRunId: options.payrollRunId ?? null,
    },
  });
}
