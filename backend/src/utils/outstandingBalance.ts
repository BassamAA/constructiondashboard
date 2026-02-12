import { Prisma } from "@prisma/client";
import prisma from "../prismaClient";

export async function calculateCustomerOldBalance(
  customerId: number,
  excludeReceiptIds: number[] = [],
): Promise<number> {
  if (!customerId) {
    return 0;
  }

  const where: Prisma.ReceiptWhereInput = {
    customerId,
    isPaid: false,
  };

  if (excludeReceiptIds.length > 0) {
    where.id = { notIn: excludeReceiptIds };
  }

  const receipts = await prisma.receipt.findMany({
    where,
    select: { id: true, total: true, amountPaid: true },
  });

  return receipts.reduce((sum, receipt) => {
    const outstanding = Math.max(
      Number(receipt.total) - Number(receipt.amountPaid ?? 0),
      0,
    );
    return sum + outstanding;
  }, 0);
}
