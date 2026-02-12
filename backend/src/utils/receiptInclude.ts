import { Prisma } from "@prisma/client";

export const receiptInclude = {
  items: { include: { product: true } },
  customer: true,
  driver: true,
  truck: true,
  jobSite: true,
  receiptPayments: {
    include: {
      payment: true,
    },
  },
  createdByUser: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
} satisfies Prisma.ReceiptInclude;
