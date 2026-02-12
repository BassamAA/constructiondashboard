import prisma from "../prismaClient";

/**
 * Outstanding per customer based solely on receipts:
 *   outstanding = sum_over_receipts(max(total - amountPaid, 0))
 * Uses the stored amountPaid on receipts; assumes payments keep receipts up to date.
 */
export async function fetchCustomerOutstandingSimple(): Promise<Map<number, number>> {
  const receipts = await prisma.receipt.findMany({
    where: { customerId: { not: null } },
    select: { id: true, customerId: true, total: true, amountPaid: true },
  });

  const outstandingMap = new Map<number, number>();
  receipts.forEach((r) => {
    if (r.customerId === null) return;
    const outstanding = Math.max(Number(r.total ?? 0) - Number(r.amountPaid ?? 0), 0);
    if (outstanding <= 0) return;
    outstandingMap.set(r.customerId, (outstandingMap.get(r.customerId) ?? 0) + outstanding);
  });

  return outstandingMap;
}
